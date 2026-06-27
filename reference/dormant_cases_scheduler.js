/**
 * Dormant Case Reminder Scheduler
 *
 * Runs daily to detect therapy cases with 6+ weeks of no interaction
 * and sends email report to therapist.
 *
 * Deployment: Cloudflare Worker, AWS Lambda, or backend cron job
 * Trigger: Daily at 06:00 AWST (configurable)
 *
 * Environment variables required:
 * - SPLOSE_API_TOKEN: Bearer token for Splose API
 * - THERAPIST_EMAIL: Recipient email address
 * - EMAIL_SERVICE_API_KEY: SendGrid, AWS SES, or similar
 * - EMAIL_SERVICE_ENDPOINT: Service URL for sending emails
 */

const INACTIVITY_THRESHOLD_WEEKS = 6;
const URGENT_PLAN_WINDOW_DAYS = 14;

/**
 * Main handler - called by scheduler
 */
async function checkAndNotifyDormantCases(config = {}) {
  const {
    sploseBearerToken = process.env.SPLOSE_API_TOKEN,
    therapistEmail = process.env.THERAPIST_EMAIL,
    emailServiceEndpoint = process.env.EMAIL_SERVICE_ENDPOINT,
    emailServiceKey = process.env.EMAIL_SERVICE_API_KEY,
  } = config;

  try {
    console.log('[Dormant Cases] Starting check at', new Date().toISOString());

    // 1. Fetch all active cases from Splose
    const cases = await fetchActiveCases(sploseBearerToken);
    console.log(`[Dormant Cases] Found ${cases.length} active cases`);

    // 2. Identify dormant cases
    const dormantCases = await identifyDormantCases(cases, sploseBearerToken);
    console.log(`[Dormant Cases] Identified ${dormantCases.length} dormant cases`);

    // 3. If any dormant cases, send email
    if (dormantCases.length > 0) {
      const emailHtml = generateEmailReport(dormantCases);
      await sendEmail({
        to: therapistEmail,
        subject: `Opal Therapy — Dormant case reminder (${dormantCases.length} cases, ${new Date().toLocaleDateString('en-AU')})`,
        html: emailHtml,
        endpoint: emailServiceEndpoint,
        apiKey: emailServiceKey,
      });
      console.log(`[Dormant Cases] Email sent to ${therapistEmail}`);
    } else {
      console.log('[Dormant Cases] No dormant cases found');
    }

    // 4. Log completion
    return {
      success: true,
      timestamp: new Date().toISOString(),
      dormantCaseCount: dormantCases.length,
      casesChecked: cases.length,
    };
  } catch (error) {
    console.error('[Dormant Cases] Error:', error);
    throw error;
  }
}

/**
 * Fetch all active cases from Splose
 */
async function fetchActiveCases(token) {
  const response = await fetch('https://api.splose.com/v1/cases', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Splose API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  // Filter: archived=false, discharged=false (or equivalent flag)
  return data.data.filter(c => !c.archived && !c.discharged);
}

/**
 * For each case, compute last activity date and check dormancy
 */
async function identifyDormantCases(cases, token) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - (INACTIVITY_THRESHOLD_WEEKS * 7));

  const dormantCases = [];

  for (const caseObj of cases) {
    try {
      // Fetch last activity: max of (last appointment, last support activity)
      const lastActivityDate = await getLastActivityDate(caseObj.id, token);

      // Check if dormant
      if (lastActivityDate && lastActivityDate < cutoffDate) {
        // Fetch client name
        const patientResp = await fetch(`https://api.splose.com/v1/patients/${caseObj.patientId}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const patient = await patientResp.json();

        // Fetch location for region
        const locationResp = await fetch(`https://api.splose.com/v1/locations/${caseObj.locationId}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const location = await locationResp.json();
        const region = deriveRegion(location.data?.suburb, location.data?.postalCode);

        // Check plan urgency
        const planExpiryDate = new Date(caseObj.expiryDate);
        const daysUntilExpiry = Math.ceil((planExpiryDate - new Date()) / (1000 * 60 * 60 * 24));
        const isUrgent = daysUntilExpiry < URGENT_PLAN_WINDOW_DAYS;

        // Suggest action
        const suggestedAction = suggestNextAction(
          caseObj.hours || 0,
          caseObj.hoursTaken || 0,
          planExpiryDate,
          lastActivityDate
        );

        dormantCases.push({
          caseId: caseObj.id,
          clientId: caseObj.patientId,
          clientName: `${patient.data.firstname} ${patient.data.lastname}`,
          region,
          lastActivityDate: lastActivityDate.toISOString().split('T')[0],
          hoursUsed: caseObj.hoursTaken || 0,
          hoursTotal: caseObj.hours || 0,
          budgetUsed: caseObj.budgetTaken || 0,
          budgetTotal: caseObj.budget || 0,
          planExpiryDate: planExpiryDate.toISOString().split('T')[0],
          daysUntilExpiry,
          isUrgent,
          suggestedAction,
          trackType: caseObj.trackType, // 'Appointments', 'Hours', or 'Budget'
        });
      }
    } catch (err) {
      console.warn(`[Dormant Cases] Error processing case ${caseObj.id}:`, err.message);
      // Continue with next case
    }
  }

  return dormantCases;
}

/**
 * Get the most recent activity date for a case
 * (max of last appointment, last support activity, optionally case notes)
 */
async function getLastActivityDate(caseId, token) {
  let lastDate = null;

  try {
    // Last appointment
    const apptResp = await fetch(
      `https://api.splose.com/v1/appointments?caseId=${caseId}&offset=0&limit=1`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const appts = await apptResp.json();
    if (appts.data && appts.data.length > 0) {
      const apptDate = new Date(appts.data[0].endTime);
      if (!lastDate || apptDate > lastDate) lastDate = apptDate;
    }
  } catch (err) {
    console.warn(`Error fetching appointments for case ${caseId}:`, err.message);
  }

  try {
    // Last support activity (e.g., invoice date)
    const supportResp = await fetch(
      `https://api.splose.com/v1/support-activities?caseId=${caseId}&offset=0&limit=1`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const support = await supportResp.json();
    if (support.data && support.data.length > 0) {
      const supportDate = new Date(support.data[0].createdAt);
      if (!lastDate || supportDate > lastDate) lastDate = supportDate;
    }
  } catch (err) {
    console.warn(`Error fetching support activities for case ${caseId}:`, err.message);
  }

  // TODO: Add case notes once Splose API exposes /case-notes endpoint
  // try {
  //   const notesResp = await fetch(
  //     `https://api.splose.com/v1/case-notes?caseId=${caseId}&offset=0&limit=1`,
  //     { headers: { 'Authorization': `Bearer ${token}` } }
  //   );
  //   const notes = await notesResp.json();
  //   if (notes.data && notes.data.length > 0) {
  //     const noteDate = new Date(notes.data[0].createdAt);
  //     if (!lastDate || noteDate > lastDate) lastDate = noteDate;
  //   }
  // } catch (err) { /* silent */ }

  return lastDate;
}

/**
 * Determine region from suburb / postcode (Willetton-centric)
 */
function deriveRegion(suburb, postcode) {
  const eastSuburbs = ['Gosnells', 'Mulgrave', 'Kalamunda', 'High Wycombe'];
  const westSuburbs = ['Fremantle', 'Melville', 'Applecross', 'Bicton', 'Lynwood'];
  const southSuburbs = ['Rockingham', 'Kwinana', 'Peel'];
  const centralSuburbs = ['Perth', 'Northbridge', 'Subiaco'];

  const s = (suburb || '').toLowerCase();
  if (eastSuburbs.some(e => s.includes(e.toLowerCase()))) return 'East';
  if (westSuburbs.some(w => s.includes(w.toLowerCase()))) return 'West';
  if (southSuburbs.some(s => s.includes(s.toLowerCase()))) return 'South';
  if (centralSuburbs.some(c => s.includes(c.toLowerCase()))) return 'Central';
  return 'Other';
}

/**
 * Suggest next action based on case state
 */
function suggestNextAction(hoursTotal, hoursUsed, planExpiryDate, lastActivityDate) {
  const hoursRemaining = hoursTotal - hoursUsed;
  const daysUntilExpiry = Math.ceil((new Date(planExpiryDate) - new Date()) / (1000 * 60 * 60 * 24));

  if (hoursRemaining <= 0) {
    return 'Discharge review — zero hours remaining';
  } else if (daysUntilExpiry < 14) {
    return 'Plan window closing — book urgently or seek extension';
  } else if (hoursRemaining < 5) {
    return 'Low hours remaining — plan extension recommended';
  } else {
    return 'Resume therapy — adequate funding available';
  }
}

/**
 * Generate HTML email report
 */
function generateEmailReport(dormantCases) {
  const now = new Date();
  const awstTime = now.toLocaleString('en-AU', { timeZone: 'Australia/Perth' });

  let casesHtml = '';
  for (const c of dormantCases) {
    const urgentClass = c.isUrgent ? 'style="background:#fff4e0;"' : '';
    casesHtml += `
      <tr ${urgentClass}>
        <td style="border:1px solid #ddd; padding:10px;">${c.clientName}</td>
        <td style="border:1px solid #ddd; padding:10px;"><code style="background:#f5f5f5; padding:2px 6px; border-radius:4px;">${c.caseId}</code></td>
        <td style="border:1px solid #ddd; padding:10px;">${c.region}</td>
        <td style="border:1px solid #ddd; padding:10px;">${c.lastActivityDate}</td>
        <td style="border:1px solid #ddd; padding:10px; text-align:right;">${c.hoursUsed} / ${c.hoursTotal}</td>
        <td style="border:1px solid #ddd; padding:10px; ${c.isUrgent ? 'color:#d97706; font-weight:600;' : ''}">${c.planExpiryDate}</td>
        <td style="border:1px solid #ddd; padding:10px;">
          <strong>${c.suggestedAction}</strong>
        </td>
      </tr>
    `;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1f2937; }
        h2 { color: #2d7a7a; }
        table { width:100%; border-collapse:collapse; margin:20px 0; }
        th { background: #e5f2f2; color: #1f5b5b; font-weight:600; border:1px solid #ddd; padding:12px; text-align:left; }
        td { border:1px solid #ddd; padding:10px; }
        .urgent { background: #fff4e0; }
        .footer { font-size:12px; color:#666; margin-top:30px; border-top:1px solid #ddd; padding-top:15px; }
        code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }
      </style>
    </head>
    <body>
      <h2>Opal Therapy — Dormant Case Report</h2>
      <p>Hi Ann,</p>
      <p><strong>${dormantCases.length} case(s)</strong> have had no interaction in the past 6 weeks and may need attention.</p>

      <table>
        <thead>
          <tr>
            <th>Client Name</th>
            <th>Case ID</th>
            <th>Region</th>
            <th>Last Activity</th>
            <th>NDIS Hours</th>
            <th>Plan Expires</th>
            <th>Suggested Action</th>
          </tr>
        </thead>
        <tbody>
          ${casesHtml}
        </tbody>
      </table>

      <h3>What to do next</h3>
      <ul>
        <li><strong style="color:#d97706;">Yellow rows:</strong> Plan expires within 14 days. Book urgently or coordinate with NDIS coordinator.</li>
        <li><strong>Resume therapy:</strong> Case has adequate funding and no urgent constraints. Reconnect with client.</li>
        <li><strong>Discharge review:</strong> Zero hours remaining or plan expired. Schedule wind-down or review session.</li>
      </ul>

      <div class="footer">
        <p>
          <strong>What counts as activity:</strong> Appointments, invoices, or case notes (when available).<br/>
          <strong>Report generated:</strong> ${awstTime} AWST<br/>
          <strong>Next check:</strong> Tomorrow at 06:00 AWST
        </p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Send email via configured service
 */
async function sendEmail({ to, subject, html, endpoint, apiKey }) {
  // Example: SendGrid
  if (endpoint.includes('sendgrid')) {
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: 'noreply@opaltherapy.com.au', name: 'Opal Therapy Scheduler' },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });
    if (!resp.ok) throw new Error(`SendGrid error: ${resp.status}`);
    return;
  }

  // Example: AWS SES (via custom endpoint)
  if (endpoint.includes('ses') || endpoint.includes('amazonaws')) {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to,
        subject,
        html,
        from: 'noreply@opaltherapy.com.au',
      }),
    });
    if (!resp.ok) throw new Error(`SES error: ${resp.status}`);
    return;
  }

  // Fallback: generic endpoint
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, subject, html }),
  });
  if (!resp.ok) throw new Error(`Email service error: ${resp.status}`);
}

// Export for use in different environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { checkAndNotifyDormantCases };
}
