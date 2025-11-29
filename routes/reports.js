const express = require("express");
const router = express.Router();
const { getQuery, allQuery } = require("../config/database");
const { authenticateToken, requireSuperAdmin } = require("../middleware/auth");

/* ============================================================
   Helpers
============================================================ */
const N = (v) => Number(v) || 0;
const toNum = (v) => parseFloat(v) || 0;
const round2 = (v) => Number(Number(v || 0).toFixed(2));


const normalizeType = (str = "") => {
  const cleaned = str
    .toString()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (cleaned.includes("prod")) return "produccion";
  if (cleaned.includes("dia")) return "aldia";

  return cleaned || "aldia";
};


/* ============================================================
   📌 WEEKLY REPORT — SUPER ADMIN ONLY
============================================================ */
router.get('/weekly', authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        error: "start_date y end_date son requeridos"
      });
    }

    // 🔹 1. ASISTENCIA SEMANAL (POR DÍA)
    const attendanceRows = await allQuery(
      `
      SELECT 
        a.date,
        COUNT(DISTINCT a.employee_id) AS present_count
      FROM attendance a
      WHERE a.date BETWEEN $1 AND $2
      GROUP BY a.date
      ORDER BY a.date ASC
      `,
      [start_date, end_date]
    );

    // 🔹 2. PRODUCCIÓN TOTAL SEMANAL (SUMADA)
    const productionTotals = await allQuery(
      `
      SELECT
        COALESCE(SUM(a.despalillo), 0) AS total_despalillo,
        COALESCE(SUM(a.escogida), 0) AS total_escogida,
        COALESCE(SUM(a.monado), 0) AS total_monado
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.date BETWEEN $1 AND $2
        AND e.type = 'Producción'

      `,
      [start_date, end_date]
    );

    // 🔹 3. AL DÍA TOTAL SEMANAL
    const alDiaTotals = await allQuery(
      `
      SELECT
        SUM(COALESCE(a.hours_extra, 0)) AS total_hours_extra,
        COUNT(*) AS total_days_worked
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.date BETWEEN $1 AND $2
        AND e.type = 'Al Día'
      `,
      [start_date, end_date]
    );

    // 🔹 4. NÓMINA SEMANAL (TU LÓGICA ORIGINAL)
    const rows = await allQuery(
      `
      SELECT 
        a.employee_id,
        e.name AS employee,
        e.dni,
        e.type AS employee_type,
        e.monthly_salary,
        a.date,

        COALESCE(a.despalillo, 0) AS despalillo,
        COALESCE(a.escogida, 0) AS escogida,
        COALESCE(a.monado, 0) AS monado,

        COALESCE(a.hours_extra, 0) AS hours_extra

      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.date BETWEEN $1 AND $2
      ORDER BY e.name ASC
      `,
      [start_date, end_date]
    );

    // 🔹 Procesar nómina exacta (igual que antes)
    const employees = {};
    for (const row of rows) {
      const id = row.employee_id;

      if (!employees[id]) {
        employees[id] = {
          employee_id: id,
          employee: row.employee,
          dni: row.dni,
          employee_type: row.employee_type,
          monthly_salary: row.monthly_salary,

          total_despalillo: 0,
          total_escogida: 0,
          total_monado: 0,
          hours_extra: 0,
          days_worked: 0
        };
      }

      if (row.employee_type === "Producción") {
        employees[id].total_despalillo += Number(row.despalillo);
        employees[id].total_escogida   += Number(row.escogida);
        employees[id].total_monado     += Number(row.monado);
      } else {
        employees[id].hours_extra += Number(row.hours_extra);
      }

      employees[id].days_worked++;
    }

    // 🔹 Cálculo de nómina final (idéntico al tuyo)
    const productionEmployees = [];
    const alDiaEmployees = [];

    for (const emp of Object.values(employees)) {
      if (emp.employee_type === "Producción") {
        const TDes = emp.total_despalillo * 80;
        const TEsc = emp.total_escogida * 70;
        const TMon = emp.total_monado   * 1;

        const totalProd = TDes + TEsc + TMon;

        const saturdayBonus = Number((totalProd * 0.090909).toFixed(2));
        const seventhDay    = Number((totalProd * 0.181818).toFixed(2));

        const netPay = Number((totalProd + saturdayBonus + seventhDay).toFixed(2));

        productionEmployees.push({
          employee_id: emp.employee_id,
          employee: emp.employee,
          dni: emp.dni,
          type: "Producción",

          despalillo: emp.total_despalillo,
          escogida: emp.total_escogida,
          monado: emp.total_monado,

          production_money: totalProd,
          saturday_bonus: saturdayBonus,
          seventh_day: seventhDay,
          net_pay: netPay
        });


      } else {
        const dailySalary = emp.monthly_salary / 30;
        const hourValue = dailySalary / 8;
        const overtimeValue = hourValue + hourValue * 0.25;

        const hoursMoney = Number((emp.hours_extra * overtimeValue).toFixed(2));
        const seventh = emp.days_worked >= 5 ? dailySalary : 0;

        const netPay = Number(
          (emp.days_worked * dailySalary + hoursMoney + seventh).toFixed(2)
        );

        alDiaEmployees.push({
          employee_id: emp.employee_id,
          employee: emp.employee,
          dni: emp.dni,
          type: "Al Día",

          days_worked: emp.days_worked,
          hours_extra: emp.hours_extra,
          hours_extra_money: hoursMoney,
          seventh_day: Number(seventh.toFixed(2)),
           daily_salary: Number(dailySalary.toFixed(2)), 
          net_pay: netPay
        });
      }
    }

    // 🔹 Resumen final
    const summary = {
      total_employees: productionEmployees.length + alDiaEmployees.length,
      total_production_payroll: productionEmployees.reduce((sum, e) => sum + e.net_pay, 0),
      total_aldia_payroll: alDiaEmployees.reduce((sum, e) => sum + e.net_pay, 0)
    };

    summary.total_payroll =
      summary.total_production_payroll + summary.total_aldia_payroll;

    // 🔹 RESPUESTA COMPLETA PARA EL FRONTEND
    return res.json({
      success: true,
      data: {
        summaryByDay: attendanceRows,
        productionTotals: productionTotals[0],
        alDiaTotals: alDiaTotals[0],
        production: productionEmployees,
        alDia: alDiaEmployees,
        summary
      }
    });

  } catch (error) {
    console.error("❌ Error en weekly:", error);
    res.status(500).json({ success: false, error: "Error generando reporte semanal" });
  }
});



/* ============================================================
   📌 DAILY REPORT — SUPER ADMIN ONLY
============================================================ */
router.get("/daily", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: "date is required: YYYY-MM-DD"
      });
    }

    const rows = await getQuery(
      `
      SELECT
        a.id,
        a.employee_id,
        e.name AS employee_name,
        e.type AS employee_type,
        e.monthly_salary,
        a.date,
        a.hours_extra,
        a.exit_time
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1
      ORDER BY e.name ASC
      `,
      [date]
    );

    return res.json({ success: true, data: rows });

  } catch (error) {
    console.error("❌ Error generating daily report:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/* ============================================================
   📌 DAILY REPORT FOR DASHBOARD (NO-PDF)
============================================================ */
router.get("/dashboard-daily", authenticateToken, async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: "date is required: YYYY-MM-DD"
      });
    }

    // 🔹 Empleados con registros hoy
    const attendance = await allQuery(
      `
      SELECT 
        a.employee_id,
        e.name AS employee,
        e.type AS employee_type,
        COALESCE(a.despalillo, 0) AS despalillo,
        COALESCE(a.escogida, 0) AS escogida,
        COALESCE(a.monado, 0) AS monado,
        COALESCE(a.hours_extra, 0) AS hours_extra,
        a.entry_time,
        a.exit_time
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1
      ORDER BY e.name ASC
      `,
      [date]
    );

    const attendanceNormalized = attendance.map(a => ({
      ...a,
      employee_type: normalizeType(a.employee_type)
    }));


    // 🔹 Pendientes
    const employeesAll = await allQuery(`SELECT id, name, type FROM employees ORDER BY name ASC`);
    
    const presentToday = attendanceNormalized.map(a => a.employee_id);
    
    // Normalizar pendientes de entrada
    const pendingEntry = employeesAll
      .filter(e => !presentToday.includes(e.id))
      .map(e => ({
        employee_id: e.id,
        employee_name: e.name,
        employee_type: normalizeType(e.type), // ← AQUÍ
        photo: e.photo || null
      }));

    // Normalizar pendientes de salida
    const pendingExit = attendanceNormalized
      .filter(a => !a.exit_time)
      .map(a => ({
        employee_id: a.employee_id,
        employee_name: a.employee,
        employee_type: normalizeType(a.employee_type), // ← AQUÍ
        entry_time: a.entry_time,
        photo: a.photo || null
      }));

    // 🔹 Totales de producción diaria
    const prodTotals = {
      despalillo: attendance.reduce((s, r) => s + Number(r.despalillo || 0), 0),
      escogida:   attendance.reduce((s, r) => s + Number(r.escogida || 0), 0),
      monado:     attendance.reduce((s, r) => s + Number(r.monado || 0), 0),
    };

    // 🔹 Horas extra totales
    const extraTotals = attendance.reduce((s, r) => s + Number(r.hours_extra || 0), 0);

    console.log("🔥 attendanceNormalized:", attendanceNormalized);
    console.log("🔥 pendingEntry:", pendingEntry);
    console.log("🔥 pendingExit:", pendingExit);

    return res.json({
      success: true,
      data: {
        attendance: attendanceNormalized,
        prodTotals,
        extraTotals,
        pendingEntry,
        pendingExit
      }
    });

  } catch (err) {
    console.error("❌ Daily Dashboard Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


module.exports = router;
