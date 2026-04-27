import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const auditLogSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, default: randomUUID },
    timestamp: { type: Date, default: () => new Date() },
    userId: { type: String, required: true },
    username: { type: String, required: true },
    action: { type: String, required: true },
    details: { type: String },
  },
  { timestamps: true }
);

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
