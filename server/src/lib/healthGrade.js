// Health grade = 100 - demerits, mapped to A-F.
// Inputs used:
//   - openMaintenanceCount: open/assigned/in-progress maintenance
//   - overdueInspectionCount: schedules whose next-due date is past
//   - failRatio (0..1): items marked Fail across recent inspections
//   - avgResolutionDays: mean days OPEN → RESOLVED for recent maintenance

export function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function computeHealth({
  openMaintenanceCount = 0,
  overdueInspectionCount = 0,
  failRatio = 0,
  avgResolutionDays = null,
}) {
  let score = 100;
  // Open maintenance: each open ticket −3, capped at 30
  score -= Math.min(openMaintenanceCount * 3, 30);
  // Overdue inspections: each −5, capped at 25
  score -= Math.min(overdueInspectionCount * 5, 25);
  // Fail ratio: up to 25 point penalty at 100% fail
  score -= Math.round(failRatio * 25);
  // Slow resolution: gentle penalty after 7 days, capped at 10
  if (avgResolutionDays != null && avgResolutionDays > 7) {
    score -= Math.min(Math.round((avgResolutionDays - 7) * 0.5), 10);
  }
  score = Math.max(0, Math.min(100, score));
  return { score, grade: scoreToGrade(score) };
}
