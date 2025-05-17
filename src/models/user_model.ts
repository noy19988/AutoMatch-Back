import mongoose from "mongoose";
const Schema = mongoose.Schema;

export interface IUser {
  email?: string;
  password?: string;
  _id?: string;
  refreshToken?: string[];
  lichessId?: string;
  lichessAccessToken?: string;
  balance?: number; // 💰 שדה חדש לניהול יתרה
  cheatingDetections?: {
    gameId: string;
    timestamp: Date;
    confidence: number;
    analysis: string;
  }[];
}

const userSchema = new Schema<IUser>({
  email: {
    type: String,
    unique: true,
    sparse: true,
  },
  password: {
    type: String,
  },
  refreshToken: {
    type: [String],
    default: [],
  },
  lichessId: {
    type: String,
    unique: true,
    sparse: true,
  },
  lichessAccessToken: {
    type: String,
  },
  balance: {
    type: Number,
    required: true, // חובה – תוודא שניתן ערך בקוד יצירת המשתמש
  },
  cheatingDetections: {
    type: [
      {
        gameId: String,
        timestamp: Date,
        confidence: Number,
        analysis: String,
      },
    ],
    default: [],
  },
});

const userModel = mongoose.model<IUser>("Users", userSchema);

export default userModel;
