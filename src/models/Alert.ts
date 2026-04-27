import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const alertSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, default: randomUUID },
    type: { type: String, enum: ['FIRE', 'MEDICAL', 'SECURITY'], required: true },
    room: { type: String, required: true },
    floor: { type: String },
    guestCount: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ['PENDING', 'ACKNOWLEDGED', 'RESOLVING', 'RESOLVED'],
      default: 'PENDING',
    },
    userId: { type: String, required: true },
    timestamp: { type: Date, default: () => new Date().toISOString() },
    guestMessage: { type: String },
    guestInfo: {
      language: String,
      translatedMessage: String,
      originalMessage: String,
    },
    assignedRoles: [
      {
        role: String,
        suggestion: String,
        assignee: String,
      },
    ],
    updates: [
      {
        time: { type: String, default: () => new Date().toISOString() },
        message: String,
        staffName: String,
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

export const Alert = mongoose.model('Alert', alertSchema);
