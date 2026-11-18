#!/usr/bin/env python3
"""
Builds garden/data/blakkis.json from the hand-curated spec below.

The graph structure (functions, groups, calls) is curated by hand.
This script only resolves line numbers from the real sources:
  - endLine: brace matching from the function's start line
  - call-site line: first line in the caller's range containing `token`

Usage:  python3 garden/tools/gen_data.py
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..', 'blakkis'))
OUT = os.path.normpath(os.path.join(HERE, '..', 'data', 'blakkis.json'))

# ---------------------------------------------------------------- groups
# Flow layout: columns left -> right follow a Telegram update through the bot.
FLOW_GROUPS = [
    # id,          col, title,               description
    ('entry',       0, 'Entry',              'Process start & Telegram transport (polling or webhook)'),
    ('bootstrap',   1, 'Bootstrap',          'Wires bot events into the command framework'),
    ('shared',      1, 'Shared',             'Utilities, config, strings & errors used everywhere'),
    ('dispatch',    2, 'Dispatch',           'Parse message, find context, check rights, route to command'),
    ('inline',      2, 'Inline menus',       'Tree-structured inline keyboard commands'),
    ('cmd_drink',   3, 'Drinking',           'Commands that record drinks'),
    ('cmd_start',   3, '/start menu',        'Inline keyboard main menu and its sub menus'),
    ('cmd_status',  4, 'Status',             'Current EBAC, standard drinks and graphs'),
    ('cmd_stats',   4, 'Statistics',         'Group & global statistics'),
    ('cmd_account', 4, 'Account & groups',   'Profile, joining groups, data export'),
    ('cmd_info',    4, 'Info & admin',       'Static info and admin tooling'),
    ('domain',      5, 'Alcohol math',       'Widmark-based EBAC estimation'),
    ('output',      5, 'Replies',            'Context reply helpers & message objects'),
    ('persistence', 6, 'Persistence',        'PostgreSQL models: users, groups, stats'),
]

FLOW_HUES = {
    'entry': 0x64748b, 'bootstrap': 0x0f766e, 'shared': 0x78716c, 'dispatch': 0x4338ca, 'inline': 0x7c3aed,
    'cmd_drink': 0x15803d, 'cmd_start': 0x4d7c0f, 'cmd_status': 0x16a34a, 'cmd_stats': 0x65a30d,
    'cmd_account': 0x059669, 'cmd_info': 0x0d9488, 'domain': 0xb45309, 'output': 0x0369a1, 'persistence': 0x9a3412,
}
DIR_HUES = {
    '(external)': 0x64748b, '.': 0x475569, 'app': 0x0f766e, 'app/lib': 0x4338ca,
    'app/commands': 0x15803d, 'app/commands/start': 0x4d7c0f, 'app/db': 0x9a3412,
}
EXTERNAL_TEXT = [
    'External service — not part of this repository.',
    '',
    'Delivers updates to the bot either by long polling',
    '(getUpdates, BOT_MODE=polling) or by webhook',
    '(POST /<TOKEN> handled in web.js).',
    '',
    'Receives replies: sendMessage, sendPhoto,',
    'sendDocument, editMessageText.',
]

# Files layout: one group per file, columns per directory.
DIRS = [
    # dir,                 cols
    ('(external)',          [0]),
    ('.',                   [0]),
    ('app',                 [1]),
    ('app/lib',             [2]),
    ('app/commands',        [3, 4]),
    ('app/commands/start',  [5]),
    ('app/db',              [6]),
]

FILE_DESC = {
    'index.js': 'Main entrypoint: creates the bot (polling or webhook)',
    'web.js': 'Express server receiving Telegram webhooks',
    'app/init.js': 'Sets log levels, hooks bot events, loads commands',
    'app/settings.js': 'Runtime settings from env',
    'app/constants.js': 'Drink definitions & physiological constants',
    'app/strings.js': 'All user-facing (Finnish) strings',
    'app/announcements.js': 'Release announcements shown to users',
    'app/lib/commands.js': 'Command registry & dispatcher',
    'app/lib/context.js': 'Per-user conversation context & replies',
    'app/lib/inline-keyboard-command.js': 'Inline keyboard command tree',
    'app/lib/alcomath.js': 'EBAC estimation math',
    'app/lib/utils.js': 'Bot send helpers, number parsing, misc',
    'app/lib/message.js': 'Message object constructors',
    'app/lib/linechart.js': 'Renders line charts to PNG buffers',
    'app/lib/errors.js': 'Typed errors for the dispatcher',
    'app/db/users.js': 'User model & queries',
    'app/db/groups.js': 'Group model & listings',
    'app/db/stats.js': 'Aggregate statistics queries',
}

# ---------------------------------------------------------------- functions
# (id, file, startLine, name, params, flowGroup, kind[, endLine])
# kind: fn | method | handler | phases | menu | data | external | toplevel
FUNCS = [
    ('telegram', None, 0, 'Telegram Bot API', '', 'entry', 'external'),
    ('index.boot', 'index.js', 27, 'index.js (top level)', '', 'entry', 'toplevel', 60),
    ('web.server', 'web.js', 30, 'express app', '', 'entry', 'toplevel', 45),
    ('web.webhook', 'web.js', 47, 'webhook(bot, token)', 'bot, token', 'entry', 'fn'),

    ('init.main', 'app/init.js', 27, 'init(bot)', 'bot', 'bootstrap', 'fn'),
    ('init.onMessage', 'app/init.js', 46, "on('message')", 'msg', 'bootstrap', 'fn'),
    ('init.onCallback', 'app/init.js', 54, "on('callback_query')", 'msg', 'bootstrap', 'fn'),

    ('utils.attachMethods', 'app/lib/utils.js', 165, 'attachMethods', 'msg, bot', 'bootstrap', 'fn'),
    ('utils.sendPrivate', 'app/lib/utils.js', 37, 'createSendPrivateMsgFunction', 'msg, bot', 'output', 'fn'),
    ('utils.sendChat', 'app/lib/utils.js', 53, 'createSendChatMsgFunction', 'msg, bot', 'output', 'fn'),
    ('utils.sendTo', 'app/lib/utils.js', 69, 'createSendMsgToFunction', 'msg, bot', 'output', 'fn'),
    ('utils.sendPhoto', 'app/lib/utils.js', 85, 'createSendPhotoFunction', 'msg, bot', 'output', 'fn'),
    ('utils.sendDocument', 'app/lib/utils.js', 101, 'createSendDocumentFunction', 'msg, bot', 'output', 'fn'),
    ('utils.editText', 'app/lib/utils.js', 117, 'createEditMessageTextFunction', 'msg, bot', 'output', 'fn'),
    ('utils.hookNewRelic', 'app/lib/utils.js', 133, 'hookNewRelic', 'url, func', 'shared', 'fn'),
    ('utils.roundTo', 'app/lib/utils.js', 174, 'roundTo', 'n, t', 'shared', 'fn'),
    ('utils.toNumber', 'app/lib/utils.js', 206, 'toNumber', 'num', 'shared', 'fn'),
    ('utils.encrypt', 'app/lib/utils.js', 250, 'encrypt', 'data', 'shared', 'fn'),
    ('utils.toCsv', 'app/lib/utils.js', 299, 'toCsv', 'columns, rows', 'shared', 'fn'),
    ('utils.format', 'app/lib/utils.js', 308, 'String.prototype.format', 'placeholders', 'shared', 'fn'),
    ('settings', 'app/settings.js', 26, 'settings', '', 'shared', 'data'),
    ('announcements', 'app/announcements.js', 21, 'announcements', '', 'shared', 'data', 34),
    ('constants', 'app/constants.js', 22, 'constants', '', 'shared', 'data', 122),
    ('strings', 'app/strings.js', 80, 'strings (excerpt)', '', 'shared', 'data', 135),
    ('errors', 'app/lib/errors.js', 22, 'errors', '', 'shared', 'data', 66),

    ('commands.register', 'app/lib/commands.js', 68, 'Commands.register', 'cmdName, cmdHelp, cmdScope, cmdPrivilege, cmdType, cmdDefinition', 'dispatch', 'fn'),
    ('commands.registerInline', 'app/lib/commands.js', 55, 'registerInlineCommand', 'cmdName, …, cmdDefinition', 'dispatch', 'fn'),
    ('commands.rawCall', 'app/lib/commands.js', 140, 'Commands.rawCall', 'msg', 'dispatch', 'fn'),
    ('commands.call', 'app/lib/commands.js', 154, 'Commands.call', 'firstWord, msg, words, bot_suffix', 'dispatch', 'fn'),
    ('commands.callInline', 'app/lib/commands.js', 316, 'Commands.callInline', 'cmd, context, user, msg, words', 'dispatch', 'fn'),
    ('commands.initContext', 'app/lib/commands.js', 93, 'initContext', 'userId, cmd, msg', 'dispatch', 'fn'),
    ('commands.retrieveContext', 'app/lib/commands.js', 99, 'retrieveContext', 'userId, msg', 'dispatch', 'fn'),
    ('commands.sendError', 'app/lib/commands.js', 108, 'sendErrorMessage', 'msg, err', 'dispatch', 'fn'),

    ('ikc.constructor', 'app/lib/inline-keyboard-command.js', 31, 'InlineKeyboardCommand()', 'definition, commandName, parent', 'inline', 'method'),
    ('ikc.isAvailableForUser', 'app/lib/inline-keyboard-command.js', 68, 'isAvailableForUser', 'context, user', 'inline', 'method'),
    ('ikc.getInlineKeyboard', 'app/lib/inline-keyboard-command.js', 86, 'getInlineKeyboard', 'context, user', 'inline', 'method'),
    ('ikc.getChild', 'app/lib/inline-keyboard-command.js', 124, 'getChild', 'name', 'inline', 'method'),
    ('ikc.getParent', 'app/lib/inline-keyboard-command.js', 128, 'getParent', '', 'inline', 'method'),
    ('ikc.sendTextAndKeyboard', 'app/lib/inline-keyboard-command.js', 132, 'sendTextAndKeyboard', 'text, context, user, msg', 'inline', 'method'),
    ('ikc.onSelect', 'app/lib/inline-keyboard-command.js', 149, 'onSelect', 'context, user, msg, words', 'inline', 'method'),
    ('ikc.onText', 'app/lib/inline-keyboard-command.js', 163, 'onText', 'context, user, msg, words', 'inline', 'method'),
    ('ikc.onExit', 'app/lib/inline-keyboard-command.js', 188, 'onExit', 'context, user, nextState', 'inline', 'method'),

    ('context.constructor', 'app/lib/context.js', 30, 'Context()', 'cmd, msg', 'output', 'method'),
    ('context.sendMessage', 'app/lib/context.js', 42, 'sendMessage', 'to_id, text, options', 'output', 'method'),
    ('context.editMessage', 'app/lib/context.js', 52, 'editMessage', 'message_id, chat_id, text, options', 'output', 'method'),
    ('context.privateReply', 'app/lib/context.js', 76, 'privateReply', 'text', 'output', 'method'),
    ('context.privateReplyWithKeyboard', 'app/lib/context.js', 86, 'privateReplyWithKeyboard', 'text, keyboardButtons', 'output', 'method'),
    ('context.inlineKeyboardMessage', 'app/lib/context.js', 97, 'inlineKeyboardMessage', 'text, inlineKeyboardButtons', 'output', 'method'),
    ('context.inlineKeyboardEdit', 'app/lib/context.js', 108, 'inlineKeyboardEdit', 'text, inlineKeyboardButtons', 'output', 'method'),
    ('context.chatReply', 'app/lib/context.js', 119, 'chatReply', 'text', 'output', 'method'),
    ('context.photoReply', 'app/lib/context.js', 123, 'photoReply', 'stream, caption', 'output', 'method'),
    ('context.privateDocumentReply', 'app/lib/context.js', 129, 'privateDocumentReply', 'buffer, filename, contentType', 'output', 'method'),
    ('context.sendMessageObj', 'app/lib/context.js', 133, 'sendMessageObj', 'message', 'output', 'method'),
    ('context.state', 'app/lib/context.js', 146, 'setInlineState … end', 'state / key, value / phase', 'output', 'method', 182),
    ('context.isPrivateChat', 'app/lib/context.js', 176, 'isPrivateChat', '', 'output', 'method'),

    ('message.ctors', 'app/lib/message.js', 35, 'Message constructors', 'text, options', 'output', 'fn', 75),
    ('linechart.getLineGraphBuffer', 'app/lib/linechart.js', 70, 'getLineGraphBuffer', 'data, title', 'output', 'fn'),

    ('alcomath.getWidmarkFactorForUser', 'app/lib/alcomath.js', 85, 'getWidmarkFactorForUser', 'user', 'domain', 'fn'),
    ('alcomath.getUserMetabolismRate', 'app/lib/alcomath.js', 94, 'getUserMetabolismRate', '', 'domain', 'fn'),
    ('alcomath.estimateAbsorbed', 'app/lib/alcomath.js', 103, 'estimateAbsorbedAlcoholConcentration', 'user, milligrams, drinking_period', 'domain', 'fn'),
    ('alcomath.estimateUnburned', 'app/lib/alcomath.js', 116, 'estimateUnburnedAlcohol', 'user, ebac', 'domain', 'fn'),
    ('alcomath.calculateEBACFromDrinks', 'app/lib/alcomath.js', 128, 'calculateEBACFromDrinks', 'user, drinks', 'domain', 'fn'),
    ('alcomath.calculateEBACByHour', 'app/lib/alcomath.js', 189, 'calculateEBACByHourFromDrinks', 'user, drinks, lastNHours, predictNHours', 'domain', 'fn'),
    ('alcomath.toStandardDrinks', 'app/lib/alcomath.js', 232, 'toStandardDrinks', 'alcohol_grams, decimals', 'domain', 'fn'),
    ('alcomath.isOutOfLimits', 'app/lib/alcomath.js', 236, 'isAlcoholAmountOutOfLimits', 'mg', 'domain', 'fn'),

    ('users.isAdmin', 'app/db/users.js', 49, 'User.isAdmin', '', 'persistence', 'method'),
    ('users.drinkBooze', 'app/db/users.js', 53, 'User.drinkBooze', 'amount, description', 'persistence', 'method'),
    ('users.getBooze', 'app/db/users.js', 60, 'User.getBooze', '', 'persistence', 'method'),
    ('users.getDrinkSumForXHours', 'app/db/users.js', 71, 'User.getDrinkSumForXHours', 'hours', 'persistence', 'method'),
    ('users.undoDrink', 'app/db/users.js', 83, 'User.undoDrink', '', 'persistence', 'method'),
    ('users.getBoozeForLastHours', 'app/db/users.js', 94, 'User.getBoozeForLastHours', 'hours', 'persistence', 'method'),
    ('users.joinGroup', 'app/db/users.js', 106, 'User.joinGroup', 'groupId', 'persistence', 'method'),
    ('users.leaveGroup', 'app/db/users.js', 126, 'User.leaveGroup', 'groupId', 'persistence', 'method'),
    ('users.drinkBoozeReturnEBAC', 'app/db/users.js', 146, 'User.drinkBoozeReturnEBAC', 'amount, description', 'persistence', 'method'),
    ('users.drinkBoozeLate', 'app/db/users.js', 157, 'User.drinkBoozeLate', 'drinks, hours', 'persistence', 'method'),
    ('users.updateInfo', 'app/db/users.js', 181, 'User.updateInfo', 'username, weight, gender, height, read_terms', 'persistence', 'method'),
    ('users.updateReadAnnouncements', 'app/db/users.js', 204, 'User.updateReadAnnouncements', 'count', 'persistence', 'method'),
    ('users.updateFields', 'app/db/users.js', 212, 'User.update{Weight,Height,Gender,Username}', 'value', 'persistence', 'method', 230),
    ('users.delete', 'app/db/users.js', 231, 'User.delete', '', 'persistence', 'method'),
    ('users.getLastDrink', 'app/db/users.js', 239, 'User.getLastDrink', '', 'persistence', 'method'),
    ('users.getEBACWithDrinks', 'app/db/users.js', 250, 'User.getEBACWithDrinksForLastHours', 'hours', 'persistence', 'method'),
    ('users.getLastNUniqueDrinks', 'app/db/users.js', 263, 'User.getLastNUniqueDrinks', 'n, exclude_description', 'persistence', 'method'),
    ('users.getDrinkTimesByUser', 'app/db/users.js', 276, 'User.getDrinkTimesByUser', '', 'persistence', 'method'),
    ('users.new', 'app/db/users.js', 291, 'users.new', 'userId, nick, weight, gender, height, read_terms', 'persistence', 'fn'),
    ('users.find', 'app/db/users.js', 328, 'users.find', 'userId', 'persistence', 'fn'),
    ('users.getAllData', 'app/db/users.js', 362, 'users.getAllData', 'userId', 'persistence', 'fn'),
    ('users.getUsernameFromMsg', 'app/db/users.js', 383, 'users.getUsernameFromMsg', 'msg', 'persistence', 'fn'),

    ('groups.Group', 'app/db/groups.js', 37, 'Group()', 'groupId', 'persistence', 'fn'),
    ('groups.getDrinkSumsByUser', 'app/db/groups.js', 62, 'Group.getDrinkSumsByUser', 'hours', 'persistence', 'method'),
    ('groups.getDrinkTimesByUser', 'app/db/groups.js', 86, 'Group.getDrinkTimesByUser', '', 'persistence', 'method'),
    ('groups.getStandardDrinksListing', 'app/db/groups.js', 98, 'Group.getStandardDrinksListing', '', 'persistence', 'method'),
    ('groups.getPermillesListing', 'app/db/groups.js', 140, 'Group.getPermillesListing', '', 'persistence', 'method'),

    ('stats.getGlobalStats', 'app/db/stats.js', 34, 'stats.getGlobalStats', '', 'persistence', 'fn'),
    ('stats.getGroupStats', 'app/db/stats.js', 75, 'stats.getGroupStats', 'group, hours', 'persistence', 'fn'),
    ('stats.getGroupAlcoholSumStats', 'app/db/stats.js', 103, 'stats.getGroupAlcoholSumStats', 'group, hours', 'persistence', 'fn'),

    # --- commands
    ('kalja033', 'app/commands/kalja033.js', 31, '/kalja033', 'context, msg, words, user', 'cmd_drink', 'handler'),
    ('kalja05', 'app/commands/kalja05.js', 29, '/kalja05', 'context, msg, words, user', 'cmd_drink', 'handler'),
    ('juoma.saveDrink', 'app/commands/juoma.js', 59, 'saveDrink', 'context, user, milligrams, drinkName', 'cmd_drink', 'fn'),
    ('juoma.phases', 'app/commands/juoma.js', 74, '/juoma phases', 'start → miedot | tiukat | oma → END', 'cmd_drink', 'phases'),
    ('jalkikellotus.phases', 'app/commands/jalkikellotus.js', 34, '/jalkikellotus phases', 'start → inputDrinks → END', 'cmd_drink', 'phases'),
    ('laatta.phases', 'app/commands/laatta.js', 30, '/laatta phases', 'start → END', 'cmd_drink', 'phases'),

    ('start.root', 'app/commands/start.js', 50, '/start root menu', '_onSelect, _formHeader', 'cmd_start', 'menu'),
    ('start.makeDrinksString', 'app/commands/start.js', 32, 'makeDrinksString', 'drinks', 'cmd_start', 'fn'),
    ('start.juo', 'app/commands/start/juo.js', 70, 'Juo (drink) submenu', 'menu tree', 'cmd_start', 'menu'),
    ('start.juo.makeDrinkOption', 'app/commands/start/juo.js', 32, 'makeDrinkOption', 'drink_amount, drink_name', 'cmd_start', 'fn'),
    ('start.juo.makeDrinksListString', 'app/commands/start/juo.js', 52, 'makeDrinksListString', 'drinks', 'cmd_start', 'fn'),
    ('start.tilastoja', 'app/commands/start/tilastoja.js', 93, 'Tilastoja (stats) submenu', 'menu tree', 'cmd_start', 'menu'),
    ('start.tilastoja.statsForDays', 'app/commands/start/tilastoja.js', 31, 'statsForDays', 'context, user, msg, words, days', 'cmd_start', 'fn'),
    ('start.tilastoja.makeSubMenu', 'app/commands/start/tilastoja.js', 49, 'makeSubMenuStatsFunction', 'days', 'cmd_start', 'fn'),
    ('start.asetukset', 'app/commands/start/asetukset.js', 31, 'Asetukset (settings) submenu', 'menu tree', 'cmd_start', 'menu'),
    ('start.luo_tunnus', 'app/commands/start/luo_tunnus.js', 31, 'Luo tunnus (sign up) submenu', 'menu tree', 'cmd_start', 'menu'),
    ('start.help', 'app/commands/start/help.js', 31, 'Help submenu', 'menu tree', 'cmd_start', 'menu'),

    ('promillet', 'app/commands/promillet.js', 59, '/promillet', 'context, msg, words, user', 'cmd_status', 'handler'),
    ('promillet.makeDrinksString', 'app/commands/promillet.js', 35, 'makeDrinksString', 'drinks', 'cmd_status', 'fn'),
    ('annokset', 'app/commands/annokset.js', 60, '/annokset', 'context, msg, words, user', 'cmd_status', 'handler'),
    ('kuvaaja', 'app/commands/kuvaaja.js', 34, '/kuvaaja', 'context, msg, words, user', 'cmd_status', 'handler'),
    ('whoami', 'app/commands/whoami.js', 28, '/whoami', 'context, msg, words, user', 'cmd_status', 'handler'),

    ('stats', 'app/commands/stats.js', 31, '/stats', 'context, msg, words, user', 'cmd_stats', 'handler'),
    ('stats2', 'app/commands/stats2.js', 32, '/stats2', 'context, msg, words, user', 'cmd_stats', 'handler'),
    ('admin_stats', 'app/commands/admin_stats.js', 29, '/admin_stats', 'context, msg, words, user', 'cmd_stats', 'handler'),

    ('tunnus.phases', 'app/commands/tunnus.js', 34, '/tunnus phases', 'start → height → gender → terms', 'cmd_account', 'phases'),
    ('moro', 'app/commands/moro.js', 27, '/moro', 'context, msg, words, user', 'cmd_account', 'handler'),
    ('poistu', 'app/commands/poistu.js', 27, '/poistu', 'context, msg, words, user', 'cmd_account', 'handler'),
    ('data', 'app/commands/data.js', 32, '/data', 'context, msg', 'cmd_account', 'handler'),
    ('terms', 'app/commands/terms.js', 28, '/terms', 'context, msg, words', 'cmd_account', 'handler'),

    ('about', 'app/commands/about.js', 28, '/about', 'context, msg, words', 'cmd_info', 'handler'),
    ('help', 'app/commands/help.js', 28, '/help', 'context, msg, words', 'cmd_info', 'handler'),
    ('komennot', 'app/commands/komennot.js', 28, '/komennot', 'context, msg, words', 'cmd_info', 'handler'),
    ('admin_loglevel', 'app/commands/admin_loglevel.js', 28, '/admin_loglevel', 'context, msg, words, user', 'cmd_info', 'handler'),
]

# ---------------------------------------------------------------- calls
# (from, to, token) — token is searched inside the caller's line range.
# token None => anchor to the caller's first line.
CALLS = [
    ('telegram', 'web.webhook', None),
    ('telegram', 'init.onMessage', None),
    ('telegram', 'init.onCallback', None),
    ('index.boot', 'web.webhook', "require('./web.js')"),
    ('index.boot', 'init.main', "require('./app/init.js')"),
    ('web.webhook', 'telegram', 'bot.processUpdate'),
    ('init.main', 'init.onMessage', "bot.on('message'"),
    ('init.main', 'init.onCallback', "bot.on('callback_query'"),
    ('init.onMessage', 'utils.attachMethods', 'utils.attachMethods'),
    ('init.onMessage', 'commands.rawCall', 'Commands.rawCall'),
    ('init.onCallback', 'utils.attachMethods', 'utils.attachMethods'),
    ('init.onCallback', 'commands.call', 'Commands.call'),

    ('utils.attachMethods', 'utils.sendPrivate', 'createSendPrivateMsgFunction'),
    ('utils.attachMethods', 'utils.sendChat', 'createSendChatMsgFunction'),
    ('utils.attachMethods', 'utils.sendTo', 'createSendMsgToFunction'),
    ('utils.attachMethods', 'utils.sendPhoto', 'createSendPhotoFunction'),
    ('utils.attachMethods', 'utils.sendDocument', 'createSendDocumentFunction'),
    ('utils.attachMethods', 'utils.editText', 'createEditMessageTextFunction'),
    ('utils.sendPrivate', 'telegram', '.sendMessage'),
    ('utils.sendChat', 'telegram', '.sendMessage'),
    ('utils.sendTo', 'telegram', '.sendMessage'),
    ('utils.sendPhoto', 'telegram', '.sendPhoto'),
    ('utils.sendDocument', 'telegram', '.sendDocument'),
    ('utils.editText', 'telegram', '.editMessageText'),

    ('commands.register', 'commands.registerInline', 'registerInlineCommand('),
    ('commands.registerInline', 'ikc.constructor', 'new InlineKeyboardCommand'),
    ('commands.rawCall', 'commands.call', 'Commands.call('),
    ('commands.call', 'commands.retrieveContext', 'retrieveContext('),
    ('commands.call', 'commands.initContext', 'initContext('),
    ('commands.call', 'utils.hookNewRelic', 'hookNewRelic'),
    ('commands.call', 'context.isPrivateChat', 'isPrivateChat'),
    ('commands.call', 'users.find', '.find(msg.from.id)'),
    ('commands.call', 'users.isAdmin', 'user.isAdmin'),
    ('commands.call', 'users.updateReadAnnouncements', 'updateReadAnnouncements'),
    ('commands.call', 'commands.callInline', 'Commands.callInline('),
    ('commands.call', 'context.sendMessageObj', 'context.sendMessageObj'),
    ('commands.call', 'commands.sendError', 'sendErrorMessage('),
    # dynamic dispatch through the cmds table
    ('commands.call', 'kalja033', 'cmd.definition(context'),
    ('commands.call', 'kalja05', 'cmd.definition(context'),
    ('commands.call', 'promillet', 'cmd.definition(context'),
    ('commands.call', 'annokset', 'cmd.definition(context'),
    ('commands.call', 'kuvaaja', 'cmd.definition(context'),
    ('commands.call', 'whoami', 'cmd.definition(context'),
    ('commands.call', 'stats', 'cmd.definition(context'),
    ('commands.call', 'stats2', 'cmd.definition(context'),
    ('commands.call', 'admin_stats', 'cmd.definition(context'),
    ('commands.call', 'moro', 'cmd.definition(context'),
    ('commands.call', 'poistu', 'cmd.definition(context'),
    ('commands.call', 'data', 'cmd.definition(context'),
    ('commands.call', 'terms', 'cmd.definition(context'),
    ('commands.call', 'about', 'cmd.definition(context'),
    ('commands.call', 'help', 'cmd.definition(context'),
    ('commands.call', 'komennot', 'cmd.definition(context'),
    ('commands.call', 'admin_loglevel', 'cmd.definition(context'),
    ('commands.call', 'juoma.phases', 'phase.onValidInput'),
    ('commands.call', 'jalkikellotus.phases', 'phase.onValidInput'),
    ('commands.call', 'laatta.phases', 'phase.onValidInput'),
    ('commands.call', 'tunnus.phases', 'phase.onValidInput'),
    ('commands.initContext', 'context.constructor', 'new contexts.Context'),
    ('commands.sendError', 'utils.sendPrivate', 'sendPrivateMessage'),
    ('commands.callInline', 'ikc.onSelect', '.onSelect('),
    ('commands.callInline', 'ikc.getParent', 'getParent()'),
    ('commands.callInline', 'ikc.getChild', 'getChild('),
    ('commands.callInline', 'ikc.isAvailableForUser', 'isAvailableForUser'),
    ('commands.callInline', 'ikc.onExit', 'onExit('),
    ('commands.callInline', 'ikc.onText', 'onText('),

    ('ikc.constructor', 'ikc.constructor', 'new InlineKeyboardCommand'),
    ('ikc.isAvailableForUser', 'users.isAdmin', 'isAdmin'),
    ('ikc.getInlineKeyboard', 'ikc.isAvailableForUser', 'isAvailableForUser'),
    ('ikc.sendTextAndKeyboard', 'ikc.getInlineKeyboard', 'getInlineKeyboard'),
    ('ikc.sendTextAndKeyboard', 'context.inlineKeyboardEdit', 'inlineKeyboardEdit'),
    ('ikc.sendTextAndKeyboard', 'context.inlineKeyboardMessage', 'inlineKeyboardMessage'),
    ('ikc.onSelect', 'context.state', 'setInlineState'),
    ('ikc.onSelect', 'ikc.sendTextAndKeyboard', 'sendTextAndKeyboard'),
    ('ikc.onSelect', 'start.root', 'this.onSelectAction('),
    ('ikc.onSelect', 'start.asetukset', 'this.onSelectAction('),
    ('ikc.onSelect', 'start.tilastoja', 'this.onSelectAction('),
    ('ikc.onSelect', 'start.juo', 'this.onSelectAction('),
    ('ikc.onSelect', 'start.help', 'this.sendTextAndKeyboard'),
    ('ikc.onText', 'start.luo_tunnus', 'this.onTextAction('),
    ('ikc.onText', 'start.juo', 'this.onTextAction('),
    ('ikc.onText', 'context.privateReplyWithKeyboard', 'privateReplyWithKeyboard'),
    ('ikc.onExit', 'start.luo_tunnus', 'onExitAction'),

    ('context.sendMessage', 'utils.sendTo', 'this.msg.sendMessage'),
    ('context.editMessage', 'utils.editText', 'editMessageText'),
    ('context.privateReply', 'context.sendMessage', 'this.sendMessage'),
    ('context.privateReplyWithKeyboard', 'context.sendMessage', 'this.sendMessage'),
    ('context.inlineKeyboardMessage', 'context.sendMessage', 'this.sendMessage'),
    ('context.inlineKeyboardEdit', 'context.editMessage', 'this.editMessage'),
    ('context.chatReply', 'utils.sendTo', 'sendMessage'),
    ('context.photoReply', 'utils.sendPhoto', 'sendPhoto'),
    ('context.privateDocumentReply', 'utils.sendDocument', 'sendDocument'),
    ('context.sendMessageObj', 'utils.sendPhoto', 'sendPhoto'),
    ('context.sendMessageObj', 'utils.sendTo', 'sendMessage'),

    ('alcomath.estimateAbsorbed', 'alcomath.getWidmarkFactorForUser', 'getWidmarkFactorForUser'),
    ('alcomath.calculateEBACFromDrinks', 'alcomath.getUserMetabolismRate', 'getUserMetabolismRate'),
    ('alcomath.calculateEBACFromDrinks', 'alcomath.estimateAbsorbed', 'estimateAbsorbedAlcoholConcentration'),
    ('alcomath.calculateEBACFromDrinks', 'alcomath.estimateUnburned', 'estimateUnburnedAlcohol'),
    ('alcomath.calculateEBACByHour', 'alcomath.getUserMetabolismRate', 'getUserMetabolismRate'),
    ('alcomath.calculateEBACByHour', 'alcomath.estimateAbsorbed', 'estimateAbsorbedAlcoholConcentration'),

    ('users.drinkBoozeReturnEBAC', 'users.drinkBooze', 'drinkBooze('),
    ('users.drinkBoozeReturnEBAC', 'users.getBooze', 'getBooze'),
    ('users.drinkBoozeReturnEBAC', 'alcomath.calculateEBACFromDrinks', 'calculateEBACFromDrinks'),
    ('users.getEBACWithDrinks', 'users.getBooze', 'getBooze'),
    ('users.getEBACWithDrinks', 'alcomath.calculateEBACFromDrinks', 'calculateEBACFromDrinks'),
    ('groups.getStandardDrinksListing', 'groups.getDrinkSumsByUser', 'getDrinkSumsByUser'),
    ('groups.getPermillesListing', 'alcomath.calculateEBACFromDrinks', 'calculateEBACFromDrinks'),

    ('kalja033', 'users.drinkBoozeReturnEBAC', 'drinkBoozeReturnEBAC'),
    ('kalja033', 'context.privateReply', 'privateReply'),
    ('kalja05', 'users.drinkBoozeReturnEBAC', 'drinkBoozeReturnEBAC'),
    ('kalja05', 'context.privateReply', 'privateReply'),
    ('juoma.saveDrink', 'users.drinkBoozeReturnEBAC', 'drinkBoozeReturnEBAC'),
    ('juoma.saveDrink', 'context.privateReply', 'privateReply'),
    ('juoma.phases', 'juoma.saveDrink', 'saveDrink('),
    ('juoma.phases', 'message.ctors', 'message.Private'),
    ('juoma.phases', 'alcomath.isOutOfLimits', 'isAlcoholAmountOutOfLimits'),
    ('jalkikellotus.phases', 'message.ctors', 'message.Private'),
    ('jalkikellotus.phases', 'alcomath.isOutOfLimits', 'isAlcoholAmountOutOfLimits'),
    ('jalkikellotus.phases', 'users.drinkBoozeLate', 'drinkBoozeLate'),
    ('jalkikellotus.phases', 'context.privateReply', 'privateReply'),
    ('laatta.phases', 'message.ctors', 'message.Private'),
    ('laatta.phases', 'users.getBooze', 'getBooze'),
    ('laatta.phases', 'alcomath.calculateEBACFromDrinks', 'calculateEBACFromDrinks'),
    ('laatta.phases', 'context.privateReply', 'privateReply'),

    ('start.root', 'users.getEBACWithDrinks', 'getEBACWithDrinksForLastHours'),
    ('start.root', 'start.makeDrinksString', 'makeDrinksString('),
    ('start.root', 'alcomath.toStandardDrinks', 'toStandardDrinks'),
    ('start.juo', 'start.juo.makeDrinkOption', 'makeDrinkOption('),
    ('start.juo', 'start.juo.makeDrinksListString', 'makeDrinksListString('),
    ('start.juo', 'users.getLastNUniqueDrinks', 'getLastNUniqueDrinks'),
    ('start.juo', 'users.getEBACWithDrinks', 'getEBACWithDrinksForLastHours'),
    ('start.juo', 'alcomath.isOutOfLimits', 'isAlcoholAmountOutOfLimits'),
    ('start.juo', 'users.drinkBoozeLate', 'drinkBoozeLate'),
    ('start.juo', 'users.getLastDrink', 'getLastDrink'),
    ('start.juo', 'users.undoDrink', 'undoDrink'),
    ('start.juo', 'alcomath.calculateEBACFromDrinks', 'calculateEBACFromDrinks'),
    ('start.juo.makeDrinkOption', 'users.drinkBoozeReturnEBAC', 'drinkBoozeReturnEBAC'),
    ('start.tilastoja', 'start.tilastoja.makeSubMenu', 'makeSubMenuStatsFunction('),
    ('start.tilastoja', 'start.tilastoja.statsForDays', 'statsForDays('),
    ('start.tilastoja', 'users.getBoozeForLastHours', 'getBoozeForLastHours'),
    ('start.tilastoja.makeSubMenu', 'users.getDrinkSumForXHours', 'getDrinkSumForXHours'),
    ('start.tilastoja.statsForDays', 'users.getDrinkSumForXHours', 'getDrinkSumForXHours'),
    ('start.asetukset', 'users.updateFields', 'updateWeight'),
    ('start.asetukset', 'context.state', 'setInlineState'),
    ('start.asetukset', 'users.getUsernameFromMsg', 'getUsernameFromMsg'),
    ('start.asetukset', 'users.delete', 'user.delete'),
    ('start.luo_tunnus', 'users.getUsernameFromMsg', 'getUsernameFromMsg'),
    ('start.luo_tunnus', 'users.updateInfo', 'updateInfo'),
    ('start.luo_tunnus', 'users.new', 'users.new'),
    ('start.luo_tunnus', 'context.state', 'storeVariable'),

    ('promillet', 'users.getBooze', 'getBooze()'),
    ('promillet', 'users.getBoozeForLastHours', 'getBoozeForLastHours'),
    ('promillet', 'alcomath.calculateEBACFromDrinks', 'calculateEBACFromDrinks'),
    ('promillet', 'alcomath.getUserMetabolismRate', 'getUserMetabolismRate'),
    ('promillet', 'promillet.makeDrinksString', 'makeDrinksString('),
    ('promillet', 'context.privateReply', 'privateReply'),
    ('promillet', 'groups.Group', 'new groups.Group'),
    ('promillet', 'groups.getPermillesListing', 'getPermillesListing'),
    ('promillet', 'context.chatReply', 'chatReply'),
    ('annokset', 'users.getBooze', 'getBooze()'),
    ('annokset', 'alcomath.calculateEBACFromDrinks', 'calculateEBACFromDrinks'),
    ('annokset', 'context.privateReply', 'privateReply'),
    ('annokset', 'groups.getStandardDrinksListing', 'getStandardDrinksListing'),
    ('annokset', 'context.chatReply', 'chatReply'),
    ('kuvaaja', 'context.isPrivateChat', 'isPrivateChat'),
    ('kuvaaja', 'groups.getDrinkTimesByUser', 'group.getDrinkTimesByUser'),
    ('kuvaaja', 'users.getDrinkTimesByUser', 'user.getDrinkTimesByUser'),
    ('kuvaaja', 'alcomath.calculateEBACByHour', 'calculateEBACByHourFromDrinks'),
    ('kuvaaja', 'linechart.getLineGraphBuffer', 'getLineGraphBuffer'),
    ('kuvaaja', 'context.photoReply', 'photoReply'),
    ('whoami', 'context.privateReply', 'privateReply'),

    ('stats', 'context.isPrivateChat', 'isPrivateChat'),
    ('stats', 'users.getDrinkSumForXHours', 'getDrinkSumForXHours'),
    ('stats', 'stats.getGroupStats', 'getGroupStats'),
    ('stats', 'context.chatReply', 'chatReply'),
    ('stats2', 'context.isPrivateChat', 'isPrivateChat'),
    ('stats2', 'users.getDrinkSumForXHours', 'getDrinkSumForXHours'),
    ('stats2', 'stats.getGroupAlcoholSumStats', 'getGroupAlcoholSumStats'),
    ('stats2', 'alcomath.toStandardDrinks', 'toStandardDrinks'),
    ('stats2', 'context.chatReply', 'chatReply'),
    ('admin_stats', 'stats.getGlobalStats', 'getGlobalStats'),
    ('admin_stats', 'context.privateReply', 'privateReply'),

    ('tunnus.phases', 'message.ctors', 'message.Private'),
    ('tunnus.phases', 'users.updateInfo', 'updateInfo'),
    ('tunnus.phases', 'users.new', 'users.new'),
    ('tunnus.phases', 'context.privateReply', 'privateReply'),
    ('moro', 'users.joinGroup', 'joinGroup'),
    ('moro', 'context.chatReply', 'chatReply'),
    ('poistu', 'users.leaveGroup', 'leaveGroup'),
    ('poistu', 'context.chatReply', 'chatReply'),
    ('data', 'users.getAllData', 'getAllData'),
    ('data', 'context.privateDocumentReply', 'privateDocumentReply'),
    ('admin_loglevel', 'context.privateReply', 'privateReply'),
]


# ---------------------------------------------------------------- helpers
_src_cache = {}


def src_lines(path):
    if path not in _src_cache:
        with open(os.path.join(REPO, path), encoding='utf-8') as f:
            _src_cache[path] = f.read().split('\n')
    return _src_cache[path]


def find_end(path, start):
    """Brace-match from line `start` (1-based). Skips strings and comments."""
    lines = src_lines(path)
    depth, seen = 0, False
    in_block = False
    for i in range(start - 1, len(lines)):
        s = lines[i]
        j, quote = 0, None
        while j < len(s):
            c = s[j]
            if in_block:
                if s.startswith('*/', j):
                    in_block = False
                    j += 1
            elif quote:
                if c == '\\':
                    j += 1
                elif c == quote:
                    quote = None
            elif s.startswith('//', j):
                break
            elif s.startswith('/*', j):
                in_block = True
                j += 1
            elif c in '\'"`':
                quote = c
            elif c in '{[(' and c == '{':
                depth += 1
                seen = True
            elif c == '}':
                depth -= 1
                if seen and depth == 0:
                    return i + 1
            j += 1
    return start


def main():
    files, functions, warnings = {}, [], []
    by_id = {}
    for spec in FUNCS:
        fid, path, start, name, params, group, kind = spec[:7]
        end = spec[7] if len(spec) > 7 else None
        if path is None:
            start = end = 0
        elif end is None:
            end = find_end(path, start)
        fn = dict(id=fid, file=path or '(external)', name=name, params=params,
                  startLine=start, endLine=end, flowGroup=group, kind=kind)
        functions.append(fn)
        by_id[fid] = fn
        if path:
            files.setdefault(path, dict(id=path, path=path, dir=os.path.dirname(path) or '.',
                                        desc=FILE_DESC.get(path, '')))
    files['(external)'] = dict(id='(external)', path='(external)', dir='(external)',
                               desc='Telegram servers — outside this repo')

    calls, links = [], []
    ident = re.compile(r'[A-Za-z_]\w*')
    for frm, to, token in CALLS:
        a, b = by_id.get(frm), by_id.get(to)
        if not a or not b:
            warnings.append(f'unknown id in call {frm} -> {to}')
            continue
        line = a['startLine']
        if token and a['startLine']:
            lines = src_lines(a['file'])
            for ln in range(a['startLine'], a['endLine'] + 1):
                if token in lines[ln - 1]:
                    line = ln
                    break
            else:
                warnings.append(f'token {token!r} not found in {frm} ({a["file"]}:{a["startLine"]}-{a["endLine"]})')
        calls.append(dict(**{'from': frm, 'to': to, 'line': line}))
        # clickable span in the caller's code: the callee's short name, else the token's last identifier
        if token and a['startLine'] and b['kind'] != 'external':
            raw = src_lines(a['file'])[line - 1]
            names = [n for n in ident.findall(b['name']) if n not in ('User', 'Group', 'Commands', 'users', 'stats', 'on')]
            span = None
            for n in reversed(names):
                m = re.search(r'\b' + re.escape(n) + r'\b', raw)
                if m:
                    span = (m.start(), len(n))
                    break
            if not span:
                ids = ident.findall(token)
                k = raw.find(token)
                if ids and k >= 0:
                    j = raw.find(ids[-1], k)
                    span = (j, len(ids[-1]))
            if span:
                links.append({'from': frm, 'to': to, 'line': line, 'col': span[0], 'len': span[1]})

    # file -> file requires (relative requires only)
    requires = set()
    req_re = re.compile(r"require\('(\.{1,2}/[^']+)'\)")
    for path in list(files):
        if path == '(external)':
            continue
        for ln in src_lines(path):
            for m in req_re.finditer(ln):
                target = os.path.normpath(os.path.join(os.path.dirname(path), m.group(1)))
                if target.endswith('.json'):
                    continue
                if not target.endswith('.js'):
                    target += '.js'
                if target in files and target != path:
                    requires.add((path, target))
    # commands loaded by init.js: include every command file present
    requires = [dict(**{'from': a, 'to': b}) for a, b in sorted(requires)]

    file_groups = []
    for d, cols in DIRS:
        members = sorted(p for p, f in files.items() if f['dir'] == d)
        for i, p in enumerate(members):
            file_groups.append(dict(id=p, title=os.path.basename(p) if p != '(external)' else 'Telegram Bot API',
                                    desc=files[p]['desc'], col=cols[i * len(cols) // max(1, len(members))],
                                    dir=d))

    for fg in file_groups:
        fg['hue'] = DIR_HUES.get(fg['dir'], 0x64748b)
    by_id['telegram']['desc'] = EXTERNAL_TEXT
    data = dict(
        repo='blakkis', title='blakkis', lang='js', root='blakkis',
        files=list(files.values()),
        groups=dict(
            flow=[dict(id=g, col=c, title=t, desc=d, hue=FLOW_HUES[g]) for g, c, t, d in FLOW_GROUPS],
            files=file_groups,
        ),
        dirs=[dict(dir=d, cols=c, hue=DIR_HUES.get(d, 0x64748b)) for d, c in DIRS],
        functions=functions,
        calls=calls,
        links=links,
        requires=requires,
        ubiquitous=['app/strings.js', 'app/constants.js', 'app/settings.js', 'app/lib/utils.js', 'app/lib/commands.js'],
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    print(f'wrote {OUT}: {len(functions)} functions, {len(calls)} calls, {len(links)} links, {len(requires)} requires, {len(files)} files')
    for w in warnings:
        print('WARN', w, file=sys.stderr)


if __name__ == '__main__':
    main()
