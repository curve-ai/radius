import { integer, text } from "drizzle-orm/sqlite-core";

export const id = (name: string) => text(name).notNull();
export const timestamp = (name: string) => integer(name);
