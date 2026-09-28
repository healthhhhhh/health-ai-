import { Controller, DynamicModule, Get, Inject, Injectable, Module, OnApplicationShutdown, type Provider } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AuditService } from "./common/audit";
import { AuthGuard } from "./common/auth";
import { ErrorFilter } from "./common/errors";
import { MemoryRateLimitStore, RATE_LIMIT_STORE, RateLimiter, RateLimitGuard, type RateLimitStore } from "./common/rate-limit";
import { CONFIG, type AppConfig } from "./config";
import { DATABASE, type Database } from "./db/database";
import { AccountController } from "./modules/account/account.controller";
import { AccountService } from "./modules/account/account.service";
import { AiGateway } from "./modules/ai/ai.gateway";
import { AI_PROVIDER, type AiProvider } from "./modules/ai/ai.types";
import { AuthController } from "./modules/auth/auth.controller";
import { AuthService } from "./modules/auth/auth.service";
import { TokenService } from "./modules/auth/token.service";
import { IDENTITY, LocalIdentityProvider, SupabaseIdentityProvider, type IdentityProvider } from "./modules/auth/identity";
import { EMBEDDINGS, type EmbeddingProvider } from "./modules/memory/embeddings";
import { embeddingsFor } from "./adapters";
import { ChatController } from "./modules/chat/chat.controller";
import { CheckInsController } from "./modules/checkins/checkins.controller";
import { PlanController, PlanService, RemindersController } from "./modules/plan/plan.controller";
import { SymptomsController, SymptomsService } from "./modules/symptoms/symptoms.controller";
import { CareController, CareService } from "./modules/care/care.controller";
import { ChatService } from "./modules/chat/chat.service";
import { DocumentsController, UploadsController } from "./modules/documents/documents.controller";
import { DocumentsService } from "./modules/documents/documents.service";
import { InProcessJobQueue, JobQueue } from "./modules/documents/job-queue";
import { STORAGE, type ObjectStorage } from "./modules/documents/storage";
import { HealthDataController, HealthKitController } from "./modules/health-data/health-data.controller";
import { HealthDataService } from "./modules/health-data/health-data.service";
import { MemoryController } from "./modules/memory/memory.controller";
import { MemoryService } from "./modules/memory/memory.service";
import { ProfileController } from "./modules/profile/profile.controller";
import { ProfileService } from "./modules/profile/profile.service";
import { TimelineController } from "./modules/timeline/timeline.controller";
import { TimelineService } from "./modules/timeline/timeline.service";

@Controller()
class HealthController {
  constructor(@Inject(AI_PROVIDER) private readonly ai: AiProvider) {}

  /** Liveness probe. */
  @Get("health")
  health() {
    return { status: "ok" };
  }

  /** Lets clients show an honest "AI unavailable" state instead of failing late. */
  @Get("v1/meta")
  meta() {
    return { apiVersion: 1, ai: { available: this.ai.available, demo: this.ai.demo === true } };
  }
}

@Injectable()
class DatabaseCloser implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}
  async onApplicationShutdown() {
    await this.db.close();
  }
}

export interface AppDependencies {
  config: AppConfig;
  database: Database;
  aiProvider: AiProvider;
  storage: ObjectStorage;
  /** Defaults from config: in-process queue, embeddings per EMBEDDINGS_PROVIDER, identity per AUTH_PROVIDER. */
  jobQueue?: JobQueue;
  embeddings?: EmbeddingProvider;
  identity?: IdentityProvider;
  /** Defaults to in-memory counters (single instance). */
  rateLimitStore?: RateLimitStore;
}

/** Built from explicit dependencies so tests can swap the database, AI provider and storage. */
@Module({})
export class AppModule {
  static register(deps: AppDependencies): DynamicModule {
    const providers: Provider[] = [
      { provide: CONFIG, useValue: deps.config },
      { provide: DATABASE, useValue: deps.database },
      { provide: AI_PROVIDER, useValue: deps.aiProvider },
      { provide: STORAGE, useValue: deps.storage },
      { provide: APP_FILTER, useClass: ErrorFilter },
      DatabaseCloser,
      AuditService,
      { provide: RATE_LIMIT_STORE, useFactory: () => deps.rateLimitStore ?? new MemoryRateLimitStore() },
      RateLimiter,
      RateLimitGuard,
      TokenService,
      AuthGuard,
      AuthService,
      ProfileService,
      AccountService,
      AiGateway,
      MemoryService,
      TimelineService,
      ChatService,
      { provide: JobQueue, useFactory: () => deps.jobQueue ?? new InProcessJobQueue() },
      { provide: EMBEDDINGS, useFactory: () => deps.embeddings ?? embeddingsFor(deps.config) },
      {
        provide: IDENTITY,
        inject: [AuthService, TokenService],
        useFactory: (auth: AuthService, tokens: TokenService): IdentityProvider =>
          deps.identity ??
          (deps.config.authProvider === "supabase"
            ? new SupabaseIdentityProvider(deps.config.SUPABASE_URL!, deps.config.SUPABASE_PUBLISHABLE_KEY!, deps.config.SUPABASE_SECRET_KEY!, deps.database, {
                legacyJwtSecret: deps.config.SUPABASE_JWT_SECRET,
              })
            : new LocalIdentityProvider(auth, tokens, deps.database)),
      },
      DocumentsService,
      HealthDataService,
      PlanService,
      SymptomsService,
      CareService,
    ];
    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        ProfileController,
        AccountController,
        ChatController,
        MemoryController,
        TimelineController,
        DocumentsController,
        UploadsController,
        HealthDataController,
        CheckInsController,
        PlanController,
        RemindersController,
        SymptomsController,
        CareController,
        HealthKitController,
      ],
      providers,
    };
  }
}
