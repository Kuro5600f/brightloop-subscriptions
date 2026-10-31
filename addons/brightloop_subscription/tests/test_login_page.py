from odoo.tests import HttpCase, new_test_user, tagged

from .common import PASSWORD


@tagged('post_install', '-at_install')
class TestLoginPage(HttpCase):
    def test_login_page_renders_new_design(self):
        res = self.url_open('/web/login')
        self.assertEqual(res.status_code, 200)
        html = res.text
        for marker in ('bl-auth-card', 'bl-theme-toggle', 'bl-pass-toggle', 'name="csrf_token"',
                       'name="login"', 'name="password"', '/web/reset_password', '/web/signup'):
            self.assertIn(marker, html, marker)

    def test_social_login_buttons_follow_configuration(self):
        google = self.env.ref('auth_oauth.provider_google')
        res = self.url_open('/web/login')
        self.assertNotIn('Continue with Google', res.text)  # no client id configured: no fake button
        self.assertNotIn('Odoo.com', res.text)
        google.write({'enabled': True, 'client_id': 'demo-client-id.apps.googleusercontent.com'})
        res = self.url_open('/web/login')
        self.assertIn('Continue with Google', res.text)
        self.assertIn('accounts.google.com', res.text)
        self.assertIn('demo-client-id.apps.googleusercontent.com', res.text)

    def test_real_login_still_works(self):
        new_test_user(self.env, login='login_page@brightloop.test', password=PASSWORD)
        res = self.url_open('/web/login')
        csrf = res.text.split('name="csrf_token" value="')[1].split('"')[0]
        res = self.url_open('/web/login', data={'login': 'login_page@brightloop.test', 'password': PASSWORD,
                                                'csrf_token': csrf}, allow_redirects=False)
        self.assertEqual(res.status_code, 303)
        self.assertNotIn('/web/login', res.headers.get('Location', ''))

    def test_wrong_password_shows_error_in_new_design(self):
        res = self.url_open('/web/login')
        csrf = res.text.split('name="csrf_token" value="')[1].split('"')[0]
        res = self.url_open('/web/login', data={'login': 'nobody@brightloop.test', 'password': 'Wrong#Pass99',
                                                'csrf_token': csrf})
        self.assertIn('bl-auth-card', res.text)
        self.assertIn('Wrong login/password', res.text)
