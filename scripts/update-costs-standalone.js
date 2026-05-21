// Standalone script to update SMS costs - no dependencies on app config
// Run with: node scripts/update-costs-standalone.js <DATABASE_URL>

const { Client } = require('pg');

const MIN_COST_PER_SMS = 115;

async function updateCosts() {
  // Get database URL from command line or environment
  const dbUrl = process.argv[2] || process.env.PG_CONNECTION || process.env.DATABASE_URL;
  
  if (!dbUrl) {
    console.error('Usage: node update-costs-standalone.js <DATABASE_URL>');
    console.error('Or set PG_CONNECTION or DATABASE_URL environment variable');
    process.exit(1);
  }

  console.log('Connecting to database...');
  
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected successfully');
    
    // First update - set parts_count and cost
    console.log('\nUpdating SMS messages without cost...');
    const result1 = await client.query(`
      UPDATE sms_messages
      SET 
        parts_count = GREATEST(1, CEIL(LENGTH(body) / 70.0)),
        cost = GREATEST(1, CEIL(LENGTH(body) / 70.0)) * $1
      WHERE cost IS NULL OR cost = 0
      RETURNING id
    `, [MIN_COST_PER_SMS]);
    
    console.log(`Updated ${result1.rowCount} messages (set parts_count + cost)`);
    
    // Second update - only set cost where parts_count exists
    console.log('\nUpdating messages with parts_count but no cost...');
    const result2 = await client.query(`
      UPDATE sms_messages
      SET cost = parts_count * $1
      WHERE (cost IS NULL OR cost = 0) AND parts_count IS NOT NULL
      RETURNING id
    `, [MIN_COST_PER_SMS]);
    
    console.log(`Updated ${result2.rowCount} messages (set cost only)`);
    
    console.log('\n=== Summary ===');
    console.log(`Total updated: ${result1.rowCount + result2.rowCount}`);
    console.log('===============\n');
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

updateCosts();
