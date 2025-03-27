import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Access Denied: No Token Provided" });
  }

  if (!process.env.TOKEN_SECRET) {
    return res.status(500).json({ message: "Server Error: Missing TOKEN_SECRET" });
  }

  jwt.verify(token, process.env.TOKEN_SECRET as string, (err, payload) => {
    if (err) {
      return res.status(403).json({ message: "Invalid Token" });
    }

    const jwtPayload = payload as JwtPayload;
    req.userId = jwtPayload._id;
    next();
  });
};
