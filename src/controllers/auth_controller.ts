import { NextFunction, Request, Response } from 'express';
import userModel, { IUser } from '../models/user_model';
import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Document } from 'mongoose';

const parseDuration = (duration: string): number => {
    const units: { [key: string]: number } = {
        's': 1,
        'm': 60,
        'h': 3600,
        'd': 86400
    };

    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) {
        throw new Error('Invalid duration format');
    }

    const value = parseInt(match[1]);
    const unit = match[2];
    return value * units[unit];
};

const register = async (req: Request, res: Response) => {
    try {
        const password = req.body.password;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await userModel.create({
            email: req.body.email,
            password: hashedPassword
        });
        res.status(200).send(user);
    } catch (err) {
        res.status(400).send("wrong email or password");
    }
};

const generateTokens = (user: IUser): { accessToken: string, refreshToken: string } | null => {
    const secret = process.env.TOKEN_SECRET;

    const accessExp = process.env.TOKEN_EXPIRE ?? '3d';
    const refreshExp = process.env.REFRESH_TOKEN_EXPIRE ?? '7d';

    if (!secret) {
        return null;
    }

    const random = Math.random().toString();
    const payload = {
        _id: user._id,
        random
    };

    // Convert string duration to seconds
    const accessTokenOptions: SignOptions = { 
        expiresIn: parseDuration(accessExp)
    };
    const refreshTokenOptions: SignOptions = { 
        expiresIn: parseDuration(refreshExp)
    };

    const accessToken = jwt.sign(payload, secret, accessTokenOptions);
    const refreshToken = jwt.sign(payload, secret, refreshTokenOptions);

    if (!user.refreshToken) {
        user.refreshToken = [];
    }

    user.refreshToken.push(refreshToken);

    return {
        accessToken,
        refreshToken
    };
};

const login = async (req: Request, res: Response) => {
    try {
        // Verify user & password
        const user = await userModel.findOne({ email: req.body.email });
        if (!user) {
            res.status(400).send("wrong email or password");
            return;
        }
        const valid = await bcrypt.compare(req.body.password, user.password);
        if (!valid) {
            res.status(400).send("wrong email or password");
            return;
        }
        // Generate tokens
        const tokens = generateTokens(user);
        if (!tokens) {
            res.status(400).send("Access Denied");
            return;
        }
        await user.save();
        res.status(200).send({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            _id: user._id
        });
    } catch (err) {
        res.status(400).send("wrong email or password");
    }
};

type UserDocument = Document<unknown, {}, IUser> & IUser & Required<{
    _id: string;
}> & {
    __v: number;
}

const verifyAccessToken = (refreshToken: string | undefined) => {
    return new Promise<UserDocument>((resolve, reject) => {
        if (!refreshToken) {
            reject("Access Denied");
            return;
        }
        if (!process.env.TOKEN_SECRET) {
            reject("Server Error");
            return;
        }
        jwt.verify(refreshToken, process.env.TOKEN_SECRET, async (err: any, payload: any) => {
            if (err) {
                reject("Access Denied");
                return;
            }
            const userId = payload._id;
            try {
                const user = await userModel.findById(userId);
                if (!user) {
                    reject("Access Denied");
                    return;
                }
                if (!user.refreshToken || !user.refreshToken.includes(refreshToken)) {
                    user.refreshToken = [];
                    await user.save();
                    reject("Access Denied");
                    return;
                }
                user.refreshToken = user.refreshToken.filter((token) => token !== refreshToken);
                resolve(user);
            } catch (err) {
                reject("Access Denied");
                return;
            }
        });
    });
};

const logout = async (req: Request, res: Response) => {
    try {
        const user = await verifyAccessToken(req.body.refreshToken);

        await user.save();

        res.status(200).send("Logged out");
    } catch (err) {
        res.status(400).send("Access Denied");
        return;
    }
};

const refresh = async (req: Request, res: Response) => {
    try {
        const user = await verifyAccessToken(req.body.refreshToken);

        // Generate new tokens
        const tokens = generateTokens(user);
        await user.save();

        if (!tokens) {
            res.status(400).send("Access Denied");
            return;
        }
        // Send response
        res.status(200).send({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken
        });
    } catch (err) {
        res.status(400).send("Access Denied");
        return;
    }
};

type Payload = {
    _id: string;
}
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const authorization = req.headers.authorization;
    const token = authorization && authorization.split(" ")[1];
    if (!token) {
        res.status(401).send("Access Denied");
        return;
    }
    if (!process.env.TOKEN_SECRET) {
        res.status(400).send("Server Error");
        return;
    }

    jwt.verify(token, process.env.TOKEN_SECRET, (err, payload) => {
        if (err) {
            res.status(401).send("Access Denied");
            return;
        }
        const userId = (payload as Payload)._id;
        req.params.userId = userId;
        next();
    });
};

export default {
    register,
    login,
    logout,
    refresh
};