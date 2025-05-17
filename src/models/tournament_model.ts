import mongoose, { Document, Schema } from "mongoose";

// Match Schema
interface Match {
  player1: string;
  player2: string;
  lichessUrl: string;
  whiteUrl: string;
  blackUrl: string;
  result?: string;
  winner?: string | null;
}

// Bracket Stage Schema
interface BracketStage {
  name: string;
  matches: Match[];
  startTime?: Date;
  endTime?: Date;
}

export interface TournamentDocument extends Document {
  tournamentName: string;
  createdBy: mongoose.Types.ObjectId;
  playerIds: string[];
  maxPlayers: number;
  rated: boolean;
  entryFee: number; // ✅ חדש
  tournamentPrize: number; // ✅ חדש
  bracket: BracketStage[];
  currentStage: number;
  advancingPlayers: string[];
  winner: string | null;
  status: "active" | "completed";
  visibility?: "public" | "private";
  rankRange?: {
    label: string;
    min: number;
    max: number;
  };
}

const matchSchema = new Schema<Match>(
  {
    player1: { type: String, required: true },
    player2: { type: String, required: true },
    lichessUrl: { type: String, required: true },
    whiteUrl: { type: String, required: true },
    blackUrl: { type: String, required: true },
    result: { type: String },
    winner: { type: String, default: null },
  },
  { _id: false }
);

const bracketStageSchema = new Schema<BracketStage>(
  {
    name: { type: String, required: true },
    matches: [matchSchema],
    startTime: { type: Date },
    endTime: { type: Date },
  },
  { _id: false }
);

const tournamentSchema = new Schema<TournamentDocument>(
  {
    tournamentName: { type: String, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    playerIds: { type: [String], required: true },
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "private",
    },
    maxPlayers: { type: Number, required: true },
    rated: { type: Boolean, default: true },
    entryFee: { type: Number, default: 0 },       // ✅ חדש
    tournamentPrize: { type: Number, default: 0 },   // ✅ חדש
    bracket: [bracketStageSchema],
    currentStage: { type: Number, default: 0 },
    advancingPlayers: { type: [String], default: [] },
    winner: { type: String, default: null },
    status: {
      type: String,
      enum: ["active", "completed"],
      default: "active",
    },
    rankRange: {
      type: {
        label: String,
        min: Number,
        max: Number,
      },
    },
  },
  { timestamps: true }
);

export default mongoose.model<TournamentDocument>("Tournament", tournamentSchema);
