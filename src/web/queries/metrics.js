// Dashboard metrics queries

export async function getDashboardMetrics(pool) {
  const result = await pool.query('SELECT * FROM v_dashboard_metrics');
  return result.rows[0];
}

export async function getCurriculumFunnel(pool) {
  const result = await pool.query(`
    SELECT course_name, sequence_order, computed_status, group_count
    FROM v_curriculum_funnel
    ORDER BY sequence_order, computed_status
  `);
  return result.rows;
}

export async function getFacilitatorStats(pool) {
  const result = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE is_alumni = TRUE) AS alumni,
      ROUND(COUNT(*) FILTER (WHERE is_alumni = TRUE)::NUMERIC / COUNT(*) * 100, 1) AS alumni_pct
    FROM v_facilitator_stats
  `);
  return result.rows[0];
}
