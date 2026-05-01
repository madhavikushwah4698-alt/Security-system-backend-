import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET must be set in environment variables. Do NOT use defaults in production.");
  }

  return secret;
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
    room?: string;
  };
  io?: any;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = req.cookies?.token || (authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Token missing" });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload & AuthRequest["user"];
    req.user = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
      room: decoded.room,
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
}

export function generateToken(userId: string, username: string, role: string, room?: string) {
  return jwt.sign({ id: userId, username, role, room }, getJwtSecret(), {
    expiresIn: "15m", // short-lived access token
  });
}

// Example: Refresh token generator (stored securely, not in JS memory)
export function generateRefreshToken(userId: string) {
  return jwt.sign({ id: userId }, getJwtSecret(), {
    expiresIn: "7d", // longer-lived refresh token
  });
}
