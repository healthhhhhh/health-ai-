import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { ApiError, parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { AccountService } from "../account/account.service";
import { DocumentsService } from "./documents.service";
import { LocalObjectStorage, MAX_UPLOAD_BYTES, STORAGE, sniffContentType, type ObjectStorage } from "./storage";

const CreateBody = z.object({
  kind: z.enum(["report", "image"]),
  filename: z.string().min(1).max(255),
  contentType: z.string().max(100),
  byteSize: z.number().int().positive(),
  purpose: z.enum(["skin", "wound", "swelling", "other"]).nullable().optional(),
});
const ProcessBody = z.object({ note: z.string().trim().max(500).optional() });

@Controller("v1/documents")
@UseGuards(AuthGuard, RateLimitGuard)
export class DocumentsController {
  constructor(
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(AccountService) private readonly account: AccountService,
  ) {}

  @Post()
  @RateLimit("documents-create", 20, 60 * 60_000)
  async create(@UserId() userId: string, @Body() body: unknown) {
    const input = parseBody(CreateBody, body);
    await this.account.requireConsent(userId, "document_processing");
    return this.documents.create(userId, input);
  }

  @Post(":id/process")
  @HttpCode(202)
  @RateLimit("documents-process", 20, 60 * 60_000)
  async process(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    await this.account.requireConsent(userId, "document_processing");
    return this.documents.process(userId, id, parseBody(ProcessBody, body ?? {}).note);
  }

  @Get()
  list(@UserId() userId: string, @Query("kind") kind?: string) {
    return this.documents.list(userId, kind === "report" || kind === "image" ? kind : undefined);
  }

  @Get(":id")
  get(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.documents.get(userId, id);
  }

  /** A 5-minute signed link to download the original file. */
  @Get(":id/file")
  @RateLimit("documents-file", 60, 60_000)
  file(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.documents.fileUrl(userId, id);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.documents.remove(userId, id);
  }
}

/**
 * Receives uploads for the local storage adapter. Authorised by the signed,
 * expiring token in the URL (it grants one key and one size), like an S3
 * presigned URL.
 */
@Controller("v1/uploads")
@UseGuards(RateLimitGuard)
@RateLimit("uploads", 60, 60_000)
export class UploadsController {
  constructor(@Inject(STORAGE) private readonly storage: ObjectStorage) {}

  @Put(":token")
  @HttpCode(200)
  async upload(@Param("token") token: string, @Req() req: Request) {
    if (!(this.storage instanceof LocalObjectStorage)) throw new ApiError("not_found", "Not found.", HttpStatus.NOT_FOUND);
    const grant = this.storage.verifyToken(token, "put");
    if (!grant) throw new ApiError("forbidden", "This upload link is invalid or has expired.", HttpStatus.FORBIDDEN);
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new ApiError("bad_request", "The upload was empty.", HttpStatus.BAD_REQUEST);
    if (body.length !== grant.byteSize || body.length > MAX_UPLOAD_BYTES) {
      throw new ApiError("bad_request", "The upload size doesn't match.", HttpStatus.BAD_REQUEST);
    }
    await this.storage.write(grant.key, body);
    return { ok: true };
  }

  /** Serves a download link issued by `GET /v1/documents/:id/file` (local adapter only). */
  @Get(":token")
  async download(@Param("token") token: string, @Res() res: Response) {
    if (!(this.storage instanceof LocalObjectStorage)) throw new ApiError("not_found", "Not found.", HttpStatus.NOT_FOUND);
    const grant = this.storage.verifyToken(token, "get");
    if (!grant) throw new ApiError("forbidden", "This link is invalid or has expired.", HttpStatus.FORBIDDEN);
    const data = await this.storage.readKey(grant.key);
    if (!data) throw new ApiError("not_found", "File not found.", HttpStatus.NOT_FOUND);
    const type = sniffContentType(data) ?? "application/octet-stream";
    res.set({ "Content-Type": type, "Content-Disposition": "attachment", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    res.send(data);
  }
}
