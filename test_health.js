const axios = require('axios');

async function testHealth() {
    try {
        console.log('Testing health check...');
        const res = await axios.get('http://localhost:5001/api/health');
        console.log('Health Result:', res.data);
    } catch (error) {
        console.error('Health Check Failed:', error.message);
    }
}

testHealth();
