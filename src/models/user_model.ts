import mongoose from "mongoose";
const Schema = mongoose.Schema;

export interface IUser {
  email?: string; 
  password?: string; 
  _id?: string;
  refreshToken?: string[];
  lichessId?: string; 
}

const userSchema = new Schema<IUser>({
  email: {
    type: String,
    unique: true,
    sparse: true 
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
    sparse: true 
  },
});

const userModel = mongoose.model<IUser>("Users", userSchema);

export default userModel;
