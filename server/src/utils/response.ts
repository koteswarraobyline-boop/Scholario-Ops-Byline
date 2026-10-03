import { Response } from 'express';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function ok<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json({ success: true, data });
}

export function paginated<T>(res: Response, result: PaginatedResult<T>): void {
  res.status(200).json({
    success: true,
    data: result.data,
    pagination: {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    },
  });
}

export function created<T>(res: Response, data: T): void {
  ok(res, data, 201);
}

export function noContent(res: Response): void {
  res.status(204).send();
}

export function parsePagination(
  query: Record<string, unknown>
): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(String(query.pageSize ?? '25'), 10) || 25));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}
