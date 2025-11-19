// ===============================================================
// SERVER.JS – Producción (Railway + PostgreSQL + Cloudinary)
// ===============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

// Importar rutas y migración
const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const userRoutes = require('./routes/users');
const attendanceRoutes = require('./routes/attendance');
const reportRoutes = require('./routes/reports');
const dashboardRoutes = require('./routes/dashboard');
const devRoutes = require('./routes/dev');
const runMigration = require('./db/migrate');

const app = express();
const PORT = process.env.PORT || 5000;

// ===============================================================
// PRIMERO: EJECUTAR MIGRACIONES (si está activa la opción)
// ===============================================================
async function startServer() {
  try {
    console.log("🔄 Verificando migraciones...");

    if (process.env.RUN_MIGRATIONS === "true") {
      await runMigration();
      console.log("✅ Migración completada correctamente");
    } else {
      console.log("⏩ RUN_MIGRATIONS desactivado. No se ejecutan migraciones.");
    }

    // ===============================================================
    // MIDDLEWARES
    // ===============================================================
    app.use(helmet());
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    app.use(cors({
      origin: [
        process.env.CORS_ORIGIN,
        process.env.CORS_ORIGIN_DEV
      ],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    }));

    // ===============================================================
    // RUTAS
    // ===============================================================
    app.use('/api/auth', authRoutes);
    app.use('/api/employees', employeeRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/attendance', attendanceRoutes);
    app.use('/api/reports', reportRoutes);
    app.use('/api/dashboard', dashboardRoutes);
    app.use('/api/dev', devRoutes);

    // Health Check
    app.get('/api/health', (req, res) => {
      res.json({
        status: 'OK',
        message: 'Servidor funcionando',
        timestamp: new Date().toISOString()
      });
    });

    // 404
    app.use('*', (req, res) => {
      res.status(404).json({ error: 'Ruta no encontrada' });
    });

    // Error handler
    app.use((err, req, res, next) => {
      console.error('❌ Error global:', err);
      res.status(500).json({ error: 'Error interno del servidor' });
    });

    // ===============================================================
    // INICIAR SERVIDOR
    // ===============================================================
    app.listen(PORT, () => {
      console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    });

  } catch (error) {
    console.error("❌ Error crítico al iniciar servidor:", error);
    process.exit(1);
  }
}

// Ejecutar servidor
startServer();
