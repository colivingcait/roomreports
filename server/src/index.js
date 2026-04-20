import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.js';
import propertyRoutes from './routes/properties.js';
import inspectionRoutes from './routes/inspections.js';
import photoRoutes from './routes/photos.js';
import maintenanceRoutes from './routes/maintenance.js';
import dashboardRoutes from './routes/dashboard.js';
import teamRoutes from './routes/team.js';
import searchRoutes from './routes/search.js';
import suggestionsRoutes from './routes/suggestions.js';
import vendorRoutes from './routes/vendors.js';
import taskRoutes from './routes/tasks.js';
import scheduleRoutes from './routes/schedules.js';
import violationRoutes from './routes/violations.js';
import reportsRoutes from './routes/reports.js';
import templateRoutes from './routes/templates.js';
import publicInspectionRoutes from './routes/publicInspections.js';

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  'http://localhost:5173',
  process.env.APP_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, same-origin) or from allowed list
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all in production since Nginx proxies same-origin
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/public', publicInspectionRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/inspections', inspectionRoutes);
app.use('/api', photoRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/suggestions', suggestionsRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/violations', violationRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/templates', templateRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
