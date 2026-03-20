const axios = require('axios');

async function testLogin() {
    try {
        console.log('Testing login with admin@gmail.com / admin123');
        const res = await axios.post('http://localhost:5001/api/auth/login', {
            identifier: 'admin@gmail.com',
            password: 'admin123'
        });
        console.log('Login Result:', res.data);
    } catch (error) {
        if (error.response) {
            console.error('Login Failed Status:', error.response.status);
            console.error('Login Failed Data:', error.response.data);
        } else {
            console.error('Login Failed Message:', error.message);
        }
    }
}

testLogin();
