import "reflect-metadata";
import { type INestApplication, Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import express from "express";
import { AppModule, type AppDependencies } from "./app.module";
import { MAX_UPLOAD_BYTES } from "./modules/documents/storage";

/** Creates a configured Nest application (shared by main.ts and tests). */
export async function createApp(deps: AppDependencies, options: { logger?: boolean } = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(deps), { bodyParser: false, logger: options.logger === false ? false : undefined });
  const http = app.getHttpAdapter().getInstance() as express.Express;
  http.disable("x-powered-by");
  http.set("trust proxy", 1);
  // Raw bodies only for signed uploads; JSON (small) everywhere else.
  app.use("/v1/uploads", express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES + 1024 }));
  app.use(express.json({ limit: "1mb" }));
  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  const origins = deps.config.CORS_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean);
  if (origins?.length) app.enableCors({ origin: origins, credentials: true });
  app.enableShutdownHooks();
  await app.init();
  if (!deps.config.aiEnabled && !deps.aiProvider.demo) new Logger("Bootstrap").warn("ANTHROPIC_API_KEY is not set: AI features will report that they are unavailable.");
  return app;
}
