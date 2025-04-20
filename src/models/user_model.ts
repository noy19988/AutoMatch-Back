import mongoose from "mongoose";
const Schema = mongoose.Schema;

export interface IUser {
  email?: string; 
  password?: string; 
  _id?: string;
  refreshToken?: string[];

  lichessId?: string; // 👈 הוספה חשובה
  lichessAccessToken?: string;

}

const userSchema = new Schema<IUser>({
  email: {
    type: String,
    unique: true,

    sparse: true, // מאפשר קיום nullים ועדיין ייחודיות למי שיש ערך

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
    sparse: true, // 🆕 אותו עיקרון כמו email
  },
  lichessAccessToken: {
    type: String, // ✅ now it's in the correct place
  },
});

const userModel = mongoose.model<IUser>("Users", userSchema);

export default userModel;
