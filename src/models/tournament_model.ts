import mongoose, { Document, Schema } from "mongoose";

interface Match {
  player1: string;
  player2: string;
  lichessUrl: string;
  result?: "pending" | "player1" | "player2" | "draw";
  whiteUrl: string;
  blackUrl: string;
}

interface Round {
  matches: Match[];
}

export interface TournamentDocument extends Document {
  createdBy: mongoose.Types.ObjectId;
  playerIds: string[];
  rounds: Round[];
  winner: string | null;
  maxPlayers: number;
}

const matchSchema = new Schema<Match>(
  {
    player1: { type: String, required: true },
    player2: { type: String, required: true },
    lichessUrl: { type: String, required: true },
    whiteUrl: { type: String, required: true },
    blackUrl: { type: String, required: true },
  },
  { _id: false }
);

const roundSchema = new Schema<Round>(
  {
    matches: [matchSchema],
  },
  { _id: false }
);

const tournamentSchema = new Schema({
  createdBy: { type: String, required: true },
  playerIds: [String],
  maxPlayers: Number,
  rounds: [Object], // Your rounds array here
  winner: String,
  status: { type: String, enum: ["active", "completed"], default: "active" }, // Add a status field
});

export default mongoose.model<TournamentDocument>(
  "Tournament",
  tournamentSchema
);
