const axios = require('axios');
(async () => {
    try {
        const res = await axios.post('http://localhost:5001/api/auth/login', {
            identifier: 'admin@cs.com',
            password: 'password123'
        });
        console.log('Login success');

        const token = res.data.token;
        const dash = await axios.get('http://localhost:5001/api/admin/dashboard', {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Dash success', dash.data);

    } catch (e) {
        console.error(e.response ? e.response.data : e.message);
    }
})();
