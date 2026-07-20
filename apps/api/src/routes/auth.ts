import type { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { authenticator } from "otplib";
import crypto from "node:crypto";
import { signAccessToken } from "../lib/jwt.js";
import { recordAudit } from "../lib/audit.js";
import { isSystemLoginUser, verifySystemPassword } from "../lib/systemAuth.js";

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
  totpCode: z.string().length(6).optional(),
});

const SYSTEM_ACCOUNT_DOMAIN = "system.local";

const REFRESH_COOKIE = "panel_refresh";
// Browsers silently drop `Secure` cookies over plain HTTP. Default to secure
// (required once this sits behind TLS), but allow disabling it for an
// HTTP-only deployment via COOKIE_SECURE=false.
const COOKIE_SECURE = process.env.COOKIE_SECURE !== "false";

export default async function authRoutes(app: FastifyInstance) {
  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const body = loginSchema.parse(req.body);

    let user;

    if (isSystemLoginUser(body.identifier)) {
      const ok = await verifySystemPassword(body.identifier, body.password);
      if (!ok) {
        await recordAudit(app, req, "auth.system_login.failed", body.identifier);
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      const systemEmail = `${body.identifier}@${SYSTEM_ACCOUNT_DOMAIN}`;
      user = await app.prisma.user.upsert({
        where: { email: systemEmail },
        update: {},
        create: { email: systemEmail, authProvider: "SYSTEM", role: "ADMIN" },
      });
    } else {
      const found = await app.prisma.user.findUnique({ where: { email: body.identifier } });
      if (!found || found.authProvider !== "LOCAL" || !found.passwordHash) {
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      const passwordOk = await argon2.verify(found.passwordHash, body.password);
      if (!passwordOk) {
        await recordAudit(app, req, "auth.login.failed", found.id);
        return reply.code(401).send({ error: "Invalid credentials" });
      }
      user = found;
    }

    if (user.totpEnabled) {
      if (!body.totpCode) {
        return reply.code(200).send({ requiresTotp: true });
      }
      const totpOk = authenticator.verify({
        token: body.totpCode,
        secret: user.totpSecret ?? "",
      });
      if (!totpOk) {
        await recordAudit(app, req, "auth.totp.failed", user.id);
        return reply.code(401).send({ error: "Invalid 2FA code" });
      }
    }

    const accessToken = signAccessToken({ sub: user.id, role: user.role });

    const refreshToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await app.prisma.refreshToken.create({
      data: { tokenHash, userId: user.id, expiresAt },
    });

    reply.setCookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "strict",
      path: "/api/auth",
      expires: expiresAt,
    });

    await recordAudit(app, req, "auth.login.success", user.id);

    return { accessToken, user: { id: user.id, email: user.email, role: user.role } };
  });

  app.post("/auth/refresh", async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (!raw) return reply.code(401).send({ error: "No refresh token" });

    const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
    const stored = await app.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      return reply.code(401).send({ error: "Invalid refresh token" });
    }

    const accessToken = signAccessToken({ sub: stored.user.id, role: stored.user.role });
    return { accessToken, user: { id: stored.user.id, email: stored.user.email, role: stored.user.role } };
  });

  app.post("/auth/logout", async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (raw) {
      const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
      await app.prisma.refreshToken.updateMany({
        where: { tokenHash },
        data: { revokedAt: new Date() },
      });
    }
    reply.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
    return { ok: true };
  });
}
