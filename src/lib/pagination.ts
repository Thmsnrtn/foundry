// =============================================================================
// FOUNDRY — Pagination Helper
// Standardized cursor/offset pagination for all list views.
// =============================================================================

import { query } from '../db/client.js';

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

/**
 * Parse pagination params from query string. Defaults: page=1, limit=25.
 */
export function parsePagination(queryParams: { page?: string; limit?: string }): PaginationParams {
  const page = Math.max(1, parseInt(queryParams.page ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(queryParams.limit ?? '25', 10) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Execute a paginated query. Runs both the data query and a count query.
 */
export async function paginatedQuery<T = Record<string, unknown>>(
  sql: string,
  countSql: string,
  args: unknown[],
  countArgs: unknown[],
  pagination: PaginationParams,
): Promise<PaginatedResult<T>> {
  const [dataResult, countResult] = await Promise.all([
    query(`${sql} LIMIT ? OFFSET ?`, [...args, pagination.limit, pagination.offset]),
    query(countSql, countArgs),
  ]);

  const total = (countResult.rows[0] as Record<string, number>)?.count ?? 0;
  const totalPages = Math.ceil(total / pagination.limit);

  return {
    data: dataResult.rows as unknown as T[],
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages,
      hasNext: pagination.page < totalPages,
      hasPrev: pagination.page > 1,
    },
  };
}

/**
 * Generate HTML pagination controls.
 */
export function paginationControls(
  baseUrl: string,
  pagination: PaginatedResult<unknown>['pagination'],
): string {
  if (pagination.totalPages <= 1) return '';

  const prev = pagination.hasPrev
    ? `<a href="${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${pagination.page - 1}" class="btn btn-secondary btn-sm">&larr; Previous</a>`
    : `<span class="btn btn-secondary btn-sm" style="opacity:0.4;cursor:default;">&larr; Previous</span>`;

  const next = pagination.hasNext
    ? `<a href="${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${pagination.page + 1}" class="btn btn-secondary btn-sm">Next &rarr;</a>`
    : `<span class="btn btn-secondary btn-sm" style="opacity:0.4;cursor:default;">Next &rarr;</span>`;

  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;padding-top:1rem;border-top:1px solid #e5e7eb;">
    ${prev}
    <span style="font-size:0.8rem;color:#6b7280;">Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} total)</span>
    ${next}
  </div>`;
}
