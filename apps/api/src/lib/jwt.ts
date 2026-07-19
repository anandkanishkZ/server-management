import jwt from "jsonwebtoken";

export interface AccessTokenPayload {
  sub: string;
  role: "ADMIN" | "VIEWER";
}

const secret = process.env.JWT_SECRET;
if (!secret) {
  throw new Error("JWT_SECRET is not set");
}

export function signAccessToken(payload: AccessTokenPayload) {
  const options: jwt.SignOptions = {
    expiresIn: (process.env.JWT_ACCESS_TTL ?? "15m") as jwt.SignOptions["expiresIn"],
  };
  return jwt.sign(payload, secret as string, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, secret as string) as AccessTokenPayload;
}
