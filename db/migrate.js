const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function runMigration() {
  try {
    console.log("🔄 Iniciando migración PostgreSQL...");

    const schemaPath = path.join(__dirname, './schema.sql');

    if (!fs.existsSync(schemaPath)) {
      console.error("❌ No se encontró schema.sql");
      return;
    }

    const schemaSQL = fs.readFileSync(schemaPath, 'utf8');

    // Ejecuta múltiples sentencias
    await pool.query(schemaSQL);

    console.log("✅ Migración ejecutada correctamente");
  } catch (err) {
    console.error("❌ Error ejecutando migración:", err.message);
    throw err; // importante: NO cerrar proceso
  }
}

// Ejecutar solo si se llama manualmente desde la terminal
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log("🏁 Migración finalizada.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Migración falló:", err.message);
      process.exit(1);
    });
}

module.exports = runMigration;
