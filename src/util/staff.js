const { cfg } = require('../config/store');

const TIER_ORDER = ['helper', 'mod', 'admin', 'developer', 'head-developer', 'owner'];

function memberTier(member, db) {
  if (!member) return null;
  const owner = cfg(db, 'owner_role_id');
  const headDeveloper = cfg(db, 'head_developer_role_id');
  const developer = cfg(db, 'developer_role_id');
  const admin = cfg(db, 'admin_role_id');
  const mod = cfg(db, 'mod_role_id');
  const helper = cfg(db, 'helper_role_id');
  if (owner && member.roles.cache.has(owner)) return 'owner';
  if (headDeveloper && member.roles.cache.has(headDeveloper)) return 'head-developer';
  if (developer && member.roles.cache.has(developer)) return 'developer';
  if (admin && member.roles.cache.has(admin)) return 'admin';
  if (mod && member.roles.cache.has(mod)) return 'mod';
  if (helper && member.roles.cache.has(helper)) return 'helper';
  return null;
}

function isStaff(member, db) {
  return Boolean(memberTier(member, db));
}

function requireTier(member, db, minTier) {
  const tier = memberTier(member, db);
  const minimumRank = TIER_ORDER.indexOf(minTier);
  if (!tier || minimumRank < 0) return false;
  const rank = tier === 'head-developer'
    ? TIER_ORDER.indexOf('owner')
    : TIER_ORDER.indexOf(tier);
  return rank >= minimumRank;
}

function isAdminRoute(member, db) {
  return requireTier(member, db, 'admin');
}

module.exports = { memberTier, isStaff, requireTier, isAdminRoute, TIER_ORDER };
