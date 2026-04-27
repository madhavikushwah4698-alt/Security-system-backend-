import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const userSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, default: randomUUID },
    username: { type: String, required: true, unique: true },
    email: { type: String, unique: true, sparse: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['USER', 'STAFF', 'ADMIN'], default: 'USER' },
    room: { type: String },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
