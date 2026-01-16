// API routes for dashboard

import { Router } from 'express';
import pg from 'pg';
import { destConfig } from '../../config/database.js';
import { getDashboardMetrics, getCurriculumFunnel, getFacilitatorStats, getMonthlyMetrics } from '../queries/metrics.js';
import { getGroups, getGroupById, getGroupMembers, getRescueList, getCourseList } from '../queries/groups.js';
import { getFunnelStages, getFunnelConversions, getFunnelTimeline, getFunnelDropoff, getFunnelHealth } from '../queries/funnel.js';

const router = Router();
const { Pool } = pg;

// Create connection pool for local database
const pool = new Pool(destConfig);

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

export default router;
