import re

from odoo import api, models
from odoo.exceptions import UserError

RULES = (
    (lambda p: len(p) > 8, "more than 8 characters"),
    (lambda p: re.search(r'[A-Z]', p), "an uppercase letter"),
    (lambda p: re.search(r'[a-z]', p), "a lowercase letter"),
    (lambda p: re.search(r'[^A-Za-z0-9]', p), "a special character"),
)


class ResUsers(models.Model):
    _inherit = 'res.users'

    @api.model
    def _check_bl_password(self, password):
        missing = [msg for test, msg in RULES if not test(password or '')]
        if missing:
            raise UserError("Password must contain %s." % ', '.join(missing))

    def _set_password(self):
        # inverse of `password`: covers create, admin change, signup and reset
        for user in self:
            if user.password:
                self._check_bl_password(user.password)
        return super()._set_password()
