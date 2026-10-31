{
    'name': 'Brightloop Subscriptions',
    'version': '18.0.1.0.0',
    'summary': 'Plans, subscriptions, recurring invoices, discounts and a finance dashboard',
    'category': 'Sales/Subscriptions',
    'license': 'LGPL-3',
    'depends': ['account', 'portal', 'auth_signup', 'web'],
    'data': [
        'security/bl_security.xml',
        'security/ir.model.access.csv',
        'views/bl_plan_views.xml',
        'views/bl_quote_template_views.xml',
        'views/bl_menus.xml',
    ],
    'application': True,
}
