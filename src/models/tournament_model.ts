import mongoose, { Document, Schema } from "mongoose";

// Match Schema
interface Match {
  player1: string;
  player2: string;
  lichessUrl: string;
  result?: String;
  whiteUrl: string;
  blackUrl: string;
  winner?: string | null; // Added winner field to store the winner
}

// Round Schema
interface Round {
  matches: Match[];
}

export interface TournamentDocument extends Document {
  createdBy: mongoose.Types.ObjectId;
  playerIds: string[];
  rated: boolean;
  rounds: Round[];
  winner: string | null;
  maxPlayers: number;
  status: "active" | "completed"; // Status field added
}

const matchSchema = new Schema<Match>(
  {
    player1: { type: String, required: true },
    player2: { type: String, required: true },
    lichessUrl: { type: String, required: true },
    whiteUrl: { type: String, required: true },
    blackUrl: { type: String, required: true },
    result: {
      type: String,
    },
    winner: { type: String, default: null },
  },
  { _id: false }
);

const roundSchema = new Schema<Round>(
  {
    matches: [matchSchema],
  },
  { _id: false }
);

// Tournament Schema
const tournamentSchema = new Schema(
  {
    tournamentName: { type: String, required: true },
    createdBy: { type: String, required: true },
    playerIds: [String],
    maxPlayers: Number,
    rated: { type: Boolean, default: true },
    rounds: [roundSchema], // Corrected to an array of rounds
    winner: { type: String, default: null }, // Tournament winner
    status: { type: String, enum: ["active", "completed"], default: "active" }, // Add a status field to indicate whether the tournament is active or completed
  },
  { timestamps: true }
);

// This model will allow us to perform CRUD operations for Tournament
export default mongoose.model<TournamentDocument>(
  "Tournament",
  tournamentSchema
);
