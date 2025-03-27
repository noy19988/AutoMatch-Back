import mongoose from "mongoose";
const Schema = mongoose.Schema;

export interface IUser {
  email?: string; // הפכנו לאופציונלי כי משתמשים מ-Lichess לא חייבים מייל
  password?: string; // אותו דבר
  _id?: string;
  refreshToken?: string[];
  lichessId?: string; // 👈 הוספה חשובה
}

const userSchema = new Schema<IUser>({
  email: {
    type: String,
    unique: true,
    sparse: true // מאפשר קיום nullים ועדיין ייחודיות למי שיש ערך
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
    sparse: true // 🆕 אותו עיקרון כמו email
  },
});

const userModel = mongoose.model<IUser>("Users", userSchema);

export default userModel;
