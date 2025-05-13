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
  bracket: BracketStage[];
  currentStage: number;
  advancingPlayers: string[]; // tracking of players who advanced from currentStage
  winner: string | null;
  status: "active" | "completed";
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
    maxPlayers: { type: Number, required: true },
    rated: { type: Boolean, default: true },
    bracket: [bracketStageSchema],
    currentStage: { type: Number, default: 0 }, // שלב נוכחי
    advancingPlayers: { type: [String], default: [] }, // שחקנים שעברו שלב
    winner: { type: String, default: null },
    status: {
      type: String,
      enum: ["active", "completed"],
      default: "active",
    },
  },
  { timestamps: true }
);

export default mongoose.model<TournamentDocument>("Tournament", tournamentSchema);
