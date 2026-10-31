from odoo import fields, models


class AuthOAuthProvider(models.Model):
    _inherit = 'auth.oauth.provider'

    # Odoo's OAuth module only does the browser (implicit) flow; LinkedIn requires the server-side code flow.
    bl_code_flow = fields.Boolean('Server-side code flow',
                                  help="Exchange an authorization code on the server (needed for LinkedIn).")
    bl_token_endpoint = fields.Char('Token URL')
    bl_client_secret = fields.Char('Client Secret', groups='base.group_system', copy=False)
