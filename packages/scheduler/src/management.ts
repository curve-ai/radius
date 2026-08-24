import {
  createSchedule,
  getSchedule,
  updateSchedule,
  type CreateScheduleInput,
  type RadiusDatabase,
  type ScheduleRecord,
  type UpdateScheduleInput,
} from "@curve-ai/radius-storage";

import { validateRecurrence } from "./recurrence.js";

export async function createValidatedSchedule(
  database: RadiusDatabase,
  input: CreateScheduleInput,
): Promise<ScheduleRecord> {
  validateRecurrence(input.cronExpression, input.timezone);
  return createSchedule(database, input);
}

export async function updateValidatedSchedule(
  database: RadiusDatabase,
  scheduleId: string,
  input: UpdateScheduleInput,
): Promise<ScheduleRecord> {
  if (input.cronExpression !== undefined || input.timezone !== undefined) {
    const existing = await getSchedule(database, scheduleId);
    if (!existing) throw new Error("Schedule does not exist");
    validateRecurrence(
      input.cronExpression ?? existing.cronExpression,
      input.timezone ?? existing.timezone,
    );
  }
  return updateSchedule(database, scheduleId, input);
}
