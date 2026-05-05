import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsString()
  DATABASE_URL!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  API_PORT: number = 4000;

  @IsString()
  API_HOST: string = '0.0.0.0';

  @IsString()
  API_PUBLIC_URL!: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET!: string;

  @IsString()
  JWT_ACCESS_TTL: string = '15m';

  @IsString()
  JWT_REFRESH_TTL: string = '7d';

  @IsInt()
  @Min(16384)
  ARGON2_MEMORY_COST: number = 65536;

  @IsInt()
  @Min(1)
  ARGON2_TIME_COST: number = 3;

  @IsInt()
  @Min(1)
  ARGON2_PARALLELISM: number = 4;

  @IsString()
  @MinLength(64, { message: 'TOTP_ENC_KEY must be 32-byte hex (64 hex chars)' })
  @Matches(/^[a-fA-F0-9]{64}$/, { message: 'TOTP_ENC_KEY must be 32-byte hex' })
  TOTP_ENC_KEY!: string;

  @IsString()
  TOTP_ISSUER: string = 'Asistencia-CSSP';

  @IsInt()
  @Min(0)
  @Max(2)
  TOTP_WINDOW: number = 1;

  @IsString()
  CORS_ORIGINS: string = 'http://localhost:5173';

  @IsInt()
  @Min(1)
  RATE_LIMIT_GLOBAL_TTL: number = 60;

  @IsInt()
  @Min(1)
  RATE_LIMIT_GLOBAL_MAX: number = 120;

  @IsInt()
  @Min(1)
  RATE_LIMIT_AUTH_TTL: number = 900;

  @IsInt()
  @Min(1)
  RATE_LIMIT_AUTH_MAX: number = 5;

  @IsString()
  COOKIE_DOMAIN: string = 'localhost';

  @IsBoolean()
  COOKIE_SECURE: boolean = false;

  @IsString()
  @IsIn(['strict', 'lax', 'none'])
  COOKIE_SAMESITE: string = 'lax';

  @IsString()
  LOG_LEVEL: string = 'info';

  @IsBoolean()
  HIBP_ENABLED: boolean = true;

  @IsString()
  BREVO_API_KEY: string = '';

  @IsString()
  MAIL_FROM_EMAIL: string = 'no-reply@localhost';

  @IsString()
  MAIL_FROM_NAME: string = 'Asistencia';

  @IsInt()
  @Min(1)
  @Max(300)
  MAIL_DAILY_LIMIT: number = 290;

  @IsBoolean()
  MAIL_ENABLED: boolean = false;

  @IsString()
  TWILIO_ACCOUNT_SID: string = '';

  @IsString()
  TWILIO_AUTH_TOKEN: string = '';

  @IsString()
  TWILIO_WHATSAPP_FROM: string = 'whatsapp:+14155238886';

  @IsBoolean()
  TWILIO_ENABLED: boolean = false;
}

export function validateConfig(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  const nodeEnv = String(config['NODE_ENV'] ?? Environment.Development);
  const corsOrigins = String(config['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((s) => s.trim());
  const forbiddenSecretValues = new Set([
    '',
    'replace_with_64byte_random',
    'replace_with_different_64byte_random',
    'change_me',
    'change_me_strong_password',
    '0000000000000000000000000000000000000000000000000000000000000000',
  ]);
  const productionErrors: string[] = [];

  if (nodeEnv === Environment.Production) {
    if (forbiddenSecretValues.has(String(config['JWT_ACCESS_SECRET'] ?? ''))) {
      productionErrors.push('JWT_ACCESS_SECRET must be rotated');
    }
    if (forbiddenSecretValues.has(String(config['JWT_REFRESH_SECRET'] ?? ''))) {
      productionErrors.push('JWT_REFRESH_SECRET must be rotated');
    }
    if (String(config['COOKIE_SECURE']) !== 'true') {
      productionErrors.push('COOKIE_SECURE must be true');
    }
    if (forbiddenSecretValues.has(String(config['TOTP_ENC_KEY'] ?? ''))) {
      productionErrors.push('TOTP_ENC_KEY must be rotated');
    }
    if (!String(config['API_PUBLIC_URL'] ?? '').startsWith('https://')) {
      productionErrors.push('API_PUBLIC_URL must use HTTPS');
    }
    if (
      corsOrigins.length === 0 ||
      corsOrigins.some((origin) => !origin || origin === '*' || !origin.startsWith('https://'))
    ) {
      productionErrors.push('CORS_ORIGINS must be explicit HTTPS origins, never wildcard');
    }
  }

  if (errors.length > 0 || productionErrors.length > 0) {
    throw new Error(
      `Config validation error:\n${[errors.toString(), ...productionErrors]
        .filter(Boolean)
        .join('\n')}`,
    );
  }
  return validatedConfig;
}

export type AppConfig = {
  nodeEnv: string;
  api: { port: number; host: string; publicUrl: string };
  database: { url: string };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  argon2: { memoryCost: number; timeCost: number; parallelism: number };
  totp: { issuer: string; window: number };
  cors: { origins: string[] };
  rateLimit: {
    global: { ttl: number; max: number };
    auth: { ttl: number; max: number };
  };
  cookie: { domain: string; secure: boolean; sameSite: string };
  logging: { level: string };
  hibp: { enabled: boolean };
  mail: {
    enabled: boolean;
    brevoApiKey: string;
    fromEmail: string;
    fromName: string;
    dailyLimit: number;
  };
  twilio: {
    accountSid: string;
    authToken: string;
    whatsappFrom: string;
    enabled: boolean;
  };
};

export default (): AppConfig => ({
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  api: {
    port: Number(process.env['API_PORT'] ?? 4000),
    host: process.env['API_HOST'] ?? '0.0.0.0',
    publicUrl: process.env['API_PUBLIC_URL'] ?? 'http://localhost:4000',
  },
  database: { url: process.env['DATABASE_URL'] ?? '' },
  jwt: {
    accessSecret: process.env['JWT_ACCESS_SECRET'] ?? '',
    refreshSecret: process.env['JWT_REFRESH_SECRET'] ?? '',
    accessTtl: process.env['JWT_ACCESS_TTL'] ?? '15m',
    refreshTtl: process.env['JWT_REFRESH_TTL'] ?? '7d',
  },
  argon2: {
    memoryCost: Number(process.env['ARGON2_MEMORY_COST'] ?? 65536),
    timeCost: Number(process.env['ARGON2_TIME_COST'] ?? 3),
    parallelism: Number(process.env['ARGON2_PARALLELISM'] ?? 4),
  },
  totp: {
    issuer: process.env['TOTP_ISSUER'] ?? 'Asistencia-CSSP',
    window: Number(process.env['TOTP_WINDOW'] ?? 1),
  },
  cors: {
    origins: (process.env['CORS_ORIGINS'] ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim()),
  },
  rateLimit: {
    global: {
      ttl: Number(process.env['RATE_LIMIT_GLOBAL_TTL'] ?? 60),
      max: Number(process.env['RATE_LIMIT_GLOBAL_MAX'] ?? 120),
    },
    auth: {
      ttl: Number(process.env['RATE_LIMIT_AUTH_TTL'] ?? 900),
      max: Number(process.env['RATE_LIMIT_AUTH_MAX'] ?? 5),
    },
  },
  cookie: {
    domain: process.env['COOKIE_DOMAIN'] ?? 'localhost',
    secure: process.env['COOKIE_SECURE'] === 'true',
    sameSite: process.env['COOKIE_SAMESITE'] ?? 'lax',
  },
  logging: { level: process.env['LOG_LEVEL'] ?? 'info' },
  hibp: { enabled: process.env['HIBP_ENABLED'] !== 'false' },
  mail: {
    enabled: process.env['MAIL_ENABLED'] === 'true',
    brevoApiKey: process.env['BREVO_API_KEY'] ?? '',
    fromEmail: process.env['MAIL_FROM_EMAIL'] ?? 'no-reply@localhost',
    fromName: process.env['MAIL_FROM_NAME'] ?? 'Asistencia',
    dailyLimit: Number(process.env['MAIL_DAILY_LIMIT'] ?? 290),
  },
  twilio: {
    accountSid: process.env['TWILIO_ACCOUNT_SID'] ?? '',
    authToken: process.env['TWILIO_AUTH_TOKEN'] ?? '',
    whatsappFrom: process.env['TWILIO_WHATSAPP_FROM'] ?? 'whatsapp:+14155238886',
    enabled: process.env['TWILIO_ENABLED'] === 'true',
  },
});
