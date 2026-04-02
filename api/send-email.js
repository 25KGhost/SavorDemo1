export default async function handler(req, res) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { user_name, restaurant_name, user_email, user_phone, selected_plan, message } = req.body;

    // Basic server-side validation
    if (!user_name || !user_email || !message) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const response = await fetch(
            `https://api.emailjs.com/api/v1.0/email/send`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    service_id: process.env.EMAILJS_SERVICE_ID,
                    template_id: process.env.EMAILJS_TEMPLATE_ID,
                    user_id: process.env.EMAILJS_PUBLIC_KEY,
                    accessToken: process.env.EMAILJS_PRIVATE_KEY, // blocks unauthorized use
                    template_params: {
                        user_name,
                        restaurant_name,
                        user_email,
                        user_phone,
                        selected_plan,
                        message,
                    },
                }),
            }
        );

        if (response.ok) {
            return res.status(200).json({ success: true });
        } else {
            const errText = await response.text();
            return res.status(500).json({ error: errText });
        }
    } catch (err) {
        return res.status(500).json({ error: 'Server error' });
    }
}
