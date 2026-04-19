// API routes for dashboard

import { Router } from 'express';
import pg from 'pg';
import { destConfig } from '../../config/database.js';
import { getDashboardMetrics, getCurriculumFunnel, getFacilitatorStats, getMonthlyMetrics, getMonthlyMetricsByOrigin, getPromotionTimeline, getFacilitatorActivityRate } from '../queries/metrics.js';
import { getGroups, getGroupById, getGroupMembers, getRescueList, getCourseList } from '../queries/groups.js';
import { getFunnelStages, getFunnelConversions, getFunnelTimeline, getFunnelDropoff, getFunnelHealth } from '../queries/funnel.js';
import { getMemberFlow, getMemberProgressionStats } from '../queries/sankey.js';
import { getFacilitatorRanking, getFacilitatorLineage, getRankingSummary, getFacilitatorDetails } from '../queries/facilitatorRanking.js';
import { getProvinces, getCities, getFacilitatorsByLocation, getFacilitatorCountByLocation } from '../queries/facilitatorLocation.js';
import { getMemberProvinces, getMemberCities, getMembersByLocation, getMemberCountByLocation } from '../queries/memberLocation.js';
import { getRegion, listRegions } from '../queries/regions.js';

const router = Router();
const { Pool } = pg;

// Create connection pool for local database
const pool = new Pool(destConfig);

// Last sync info
router.get('/last-sync', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sync_completed_at, table_name, rows_synced
      FROM sync_log
      WHERE status = 'completed'
      ORDER BY sync_completed_at DESC
      LIMIT 1
    `);
    if (result.rows.length === 0) {
      return res.json({ last_sync: null });
    }
    res.json({ last_sync: result.rows[0].sync_completed_at });
  } catch (err) {
    console.error('Error fetching last sync:', err);
    res.status(500).json({ error: err.message });
  }
});

// Dashboard metrics
router.get('/metrics', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const metrics = await getDashboardMetrics(pool, dateFrom, dateTo);
    const facilitators = await getFacilitatorStats(pool, dateFrom, dateTo);
    res.json({ ...metrics, ...facilitators });
  } catch (err) {
    console.error('Error fetching metrics:', err);
    res.status(500).json({ error: err.message });
  }
});

// Curriculum funnel data
router.get('/funnel', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const funnel = await getCurriculumFunnel(pool, dateFrom, dateTo);
    res.json(funnel);
  } catch (err) {
    console.error('Error fetching funnel:', err);
    res.status(500).json({ error: err.message });
  }
});

// Monthly metrics breakdown
router.get('/metrics/monthly', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const monthly = await getMonthlyMetrics(pool, dateFrom, dateTo);
    res.json(monthly);
  } catch (err) {
    console.error('Error fetching monthly metrics:', err);
    res.status(500).json({ error: err.message });
  }
});

// Monthly metrics split by facilitator origin (promoted vs ngeslow-alumni)
router.get('/metrics/monthly-by-origin', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const rows = await getMonthlyMetricsByOrigin(pool, dateFrom, dateTo);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching monthly-by-origin:', err);
    res.status(500).json({ error: err.message });
  }
});

// Promotion timeline (new + cumulative promoted facilitators per month)
router.get('/metrics/promotion-timeline', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const rows = await getPromotionTimeline(pool, dateFrom, dateTo);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching promotion timeline:', err);
    res.status(500).json({ error: err.message });
  }
});

// Facilitator activity rate (active vs total, per origin, per month)
router.get('/metrics/facilitator-activity-rate', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const rows = await getFacilitatorActivityRate(pool, dateFrom, dateTo);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching facilitator activity rate:', err);
    res.status(500).json({ error: err.message });
  }
});

// Course list
router.get('/courses', async (req, res) => {
  try {
    const courses = await getCourseList(pool);
    res.json(courses);
  } catch (err) {
    console.error('Error fetching courses:', err);
    res.status(500).json({ error: err.message });
  }
});

// Group list with filters
router.get('/groups', async (req, res) => {
  try {
    const filters = {
      course: req.query.course,
      status: req.query.status,
    };
    const groups = await getGroups(pool, filters);
    res.json(groups);
  } catch (err) {
    console.error('Error fetching groups:', err);
    res.status(500).json({ error: err.message });
  }
});

// Single group details
router.get('/groups/:id', async (req, res) => {
  try {
    const group = await getGroupById(pool, req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    const members = await getGroupMembers(pool, req.params.id);
    res.json({ ...group, members });
  } catch (err) {
    console.error('Error fetching group:', err);
    res.status(500).json({ error: err.message });
  }
});

// Rescue list
router.get('/rescue', async (req, res) => {
  try {
    const rescueList = await getRescueList(pool);
    res.json(rescueList);
  } catch (err) {
    console.error('Error fetching rescue list:', err);
    res.status(500).json({ error: err.message });
  }
});

// CSV export - groups
router.get('/export/groups', async (req, res) => {
  try {
    const filters = {
      course: req.query.course,
      status: req.query.status,
    };
    const groups = await getGroups(pool, filters);

    const headers = ['Group Name', 'Course', 'Status', 'Facilitator', 'Members', 'Progress %', 'Days Inactive', 'City'];
    const rows = groups.map(g => [
      g.group_name,
      g.course_name || '',
      g.computed_status,
      g.facilitator_email || '',
      g.member_count,
      g.progress_pct,
      g.days_since_last_meeting || '',
      g.city || ''
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=groups.csv');
    res.send(csv);
  } catch (err) {
    console.error('Error exporting groups:', err);
    res.status(500).json({ error: err.message });
  }
});

// CSV export - rescue list
router.get('/export/rescue', async (req, res) => {
  try {
    const rescueList = await getRescueList(pool);

    const headers = ['Group Name', 'Course', 'Facilitator', 'Progress %', 'Days Inactive', 'Episodes Remaining'];
    const rows = rescueList.map(g => [
      g.group_name,
      g.course_name || '',
      g.facilitator_email || '',
      g.progress_pct,
      g.days_since_last_meeting || '',
      g.episodes_remaining
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=rescue-list.csv');
    res.send(csv);
  } catch (err) {
    console.error('Error exporting rescue list:', err);
    res.status(500).json({ error: err.message });
  }
});

// Funnel dashboard endpoints
router.get('/funnel/stages', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const stages = await getFunnelStages(pool, dateFrom, dateTo);
    res.json(stages);
  } catch (err) {
    console.error('Error fetching funnel stages:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/funnel/conversions', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const conversions = await getFunnelConversions(pool, dateFrom, dateTo);
    res.json(conversions);
  } catch (err) {
    console.error('Error fetching funnel conversions:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/funnel/timeline', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const timeline = await getFunnelTimeline(pool, dateFrom, dateTo);
    res.json(timeline);
  } catch (err) {
    console.error('Error fetching funnel timeline:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/funnel/dropoff', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const dropoff = await getFunnelDropoff(pool, dateFrom, dateTo);
    res.json(dropoff);
  } catch (err) {
    console.error('Error fetching funnel dropoff:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/funnel/health', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const health = await getFunnelHealth(pool, dateFrom, dateTo);
    res.json(health);
  } catch (err) {
    console.error('Error fetching funnel health:', err);
    res.status(500).json({ error: err.message });
  }
});

// Sankey diagram endpoints
router.get('/sankey/flow', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const flow = await getMemberFlow(pool, dateFrom, dateTo);
    res.json(flow);
  } catch (err) {
    console.error('Error fetching member flow:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/sankey/stats', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const stats = await getMemberProgressionStats(pool, dateFrom, dateTo);
    res.json(stats);
  } catch (err) {
    console.error('Error fetching member progression stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Facilitator ranking endpoints
router.get('/ranking', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const ranking = await getFacilitatorRanking(pool, limit);
    res.json(ranking);
  } catch (err) {
    console.error('Error fetching facilitator ranking:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/ranking/summary', async (req, res) => {
  try {
    const summary = await getRankingSummary(pool);
    res.json(summary);
  } catch (err) {
    console.error('Error fetching ranking summary:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/ranking/lineage', async (req, res) => {
  try {
    const facilitatorId = req.query.facilitatorId || null;
    const lineage = await getFacilitatorLineage(pool, facilitatorId);
    res.json(lineage);
  } catch (err) {
    console.error('Error fetching facilitator lineage:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/ranking/details/:facilitatorId', async (req, res) => {
  try {
    const details = await getFacilitatorDetails(pool, req.params.facilitatorId);
    if (!details) {
      return res.status(404).json({ error: 'Facilitator not found' });
    }
    res.json(details);
  } catch (err) {
    console.error('Error fetching facilitator details:', err);
    res.status(500).json({ error: err.message });
  }
});

// CSV export - facilitator ranking
router.get('/export/ranking', async (req, res) => {
  try {
    const ranking = await getFacilitatorRanking(pool, 100);

    const headers = ['Rank', 'Email', 'Groups Facilitated', 'Alumni Converted', 'Alumni Points', 'Own Members', 'Descendant Members', 'Member Points', 'Total Score'];
    const rows = ranking.map((r, i) => [
      i + 1,
      r.email,
      r.groups_facilitated,
      r.alumni_converted,
      r.alumni_points,
      r.own_members,
      r.descendant_members,
      r.member_points,
      r.total_score
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=facilitator-ranking.csv');
    res.send(csv);
  } catch (err) {
    console.error('Error exporting ranking:', err);
    res.status(500).json({ error: err.message });
  }
});

// Region endpoints
router.get('/regions', (req, res) => {
  res.json(listRegions());
});

router.get('/regions/:regionId/counts', async (req, res) => {
  const region = getRegion(req.params.regionId);
  if (!region) return res.status(404).json({ error: 'Unknown region' });
  try {
    const [fac, mem] = await Promise.all([
      getFacilitatorCountByLocation(pool, { region }),
      getMemberCountByLocation(pool, { region })
    ]);
    res.json({
      region: { id: region.id, label: region.label },
      facilitators: fac,
      members: mem
    });
  } catch (err) {
    console.error('Error fetching region counts:', err);
    res.status(500).json({ error: err.message });
  }
});

// Facilitator location endpoints
router.get('/facilitators/provinces', async (req, res) => {
  try {
    const provinces = await getProvinces(pool);
    res.json(provinces);
  } catch (err) {
    console.error('Error fetching provinces:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/facilitators/cities', async (req, res) => {
  try {
    const provinces = req.query.provinces ? req.query.provinces.split(',') : [];
    const cities = await getCities(pool, provinces);
    res.json(cities);
  } catch (err) {
    console.error('Error fetching cities:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/facilitators', async (req, res) => {
  try {
    const provinces = req.query.provinces ? req.query.provinces.split(',') : [];
    const cities = req.query.cities ? req.query.cities.split(',') : [];
    const regionId = req.query.region || null;
    const region = regionId ? getRegion(regionId) : null;
    if (regionId && !region) return res.status(400).json({ error: 'Unknown region' });
    const facilitators = await getFacilitatorsByLocation(pool, { provinces, cities, region });
    res.json(facilitators);
  } catch (err) {
    console.error('Error fetching facilitators:', err);
    res.status(500).json({ error: err.message });
  }
});

// CSV export - facilitators
router.get('/export/facilitators', async (req, res) => {
  try {
    const provinces = req.query.provinces ? req.query.provinces.split(',') : [];
    const cities = req.query.cities ? req.query.cities.split(',') : [];
    const regionId = req.query.region || null;
    const region = regionId ? getRegion(regionId) : null;
    if (regionId && !region) return res.status(400).json({ error: 'Unknown region' });
    const facilitators = await getFacilitatorsByLocation(pool, { provinces, cities, region });

    const headers = ['#', 'Name', 'Email', 'Phone', 'Province', 'City', 'Groups Facilitated', 'Members', 'Alumni'];
    const rows = facilitators.map((f, i) => [
      i + 1,
      f.name || '',
      f.email,
      f.phone || '',
      f.province || '',
      f.city || '',
      f.groups_facilitated,
      f.member_count,
      f.is_alumni ? 'Yes' : 'No'
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=facilitators.csv');
    res.send(csv);
  } catch (err) {
    console.error('Error exporting facilitators:', err);
    res.status(500).json({ error: err.message });
  }
});

// Member location endpoints
router.get('/members/provinces', async (req, res) => {
  try {
    const provinces = await getMemberProvinces(pool);
    res.json(provinces);
  } catch (err) {
    console.error('Error fetching member provinces:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/members/cities', async (req, res) => {
  try {
    const provinces = req.query.provinces ? req.query.provinces.split(',') : [];
    const cities = await getMemberCities(pool, provinces);
    res.json(cities);
  } catch (err) {
    console.error('Error fetching member cities:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/members', async (req, res) => {
  try {
    const provinces = req.query.provinces ? req.query.provinces.split(',') : [];
    const cities = req.query.cities ? req.query.cities.split(',') : [];
    const regionId = req.query.region || null;
    const region = regionId ? getRegion(regionId) : null;
    if (regionId && !region) return res.status(400).json({ error: 'Unknown region' });
    const members = await getMembersByLocation(pool, { provinces, cities, region });
    res.json(members);
  } catch (err) {
    console.error('Error fetching members:', err);
    res.status(500).json({ error: err.message });
  }
});

// CSV export - members
router.get('/export/members', async (req, res) => {
  try {
    const provinces = req.query.provinces ? req.query.provinces.split(',') : [];
    const cities = req.query.cities ? req.query.cities.split(',') : [];
    const regionId = req.query.region || null;
    const region = regionId ? getRegion(regionId) : null;
    if (regionId && !region) return res.status(400).json({ error: 'Unknown region' });
    const members = await getMembersByLocation(pool, { provinces, cities, region });

    const headers = ['#', 'Name', 'Email', 'Phone', 'Province', 'City', 'Groups Joined', 'Became Facilitator'];
    const rows = members.map((m, i) => [
      i + 1,
      m.name || '',
      m.email,
      m.phone || '',
      m.province || '',
      m.city || '',
      m.groups_joined,
      m.became_facilitator ? 'Yes' : 'No'
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=members.csv');
    res.send(csv);
  } catch (err) {
    console.error('Error exporting members:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
