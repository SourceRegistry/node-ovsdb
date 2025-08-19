import {Condition} from "../types";

/**
 * A helper function to create a condition for a UUID column.
 * @param columnName - The name of the column.
 * @param uuid - The UUID value to compare against.
 * @returns A condition array.
 */
export function uuidCondition(columnName: string, uuid: string): Condition {
    return [columnName, "==", ["uuid", uuid]];
}
