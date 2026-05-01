import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const userSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, default: randomUUID },
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['USER', 'STAFF', 'ADMIN'], default: 'USER' },
    room: { type: String },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
