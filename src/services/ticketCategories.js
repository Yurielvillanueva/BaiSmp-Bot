const ticketCategories = {
  support: {
    label: 'General support',
    description: 'Ask staff a question or get help.',
    fields: [
      { id: 'minecraft_name', label: 'Minecraft username', required: true, maxLength: 16 },
      { id: 'details', label: 'How can we help?', required: true, style: 'paragraph', maxLength: 1000 }
    ]
  },
  purchase: {
    label: 'Purchase / store',
    description: 'Get help with a purchase, rank, or store order.',
    fields: [
      { id: 'item', label: 'What did you purchase?', required: true, maxLength: 100 },
      { id: 'order_reference', label: 'Order or transaction reference (optional)', required: false, maxLength: 100 },
      { id: 'minecraft_name', label: 'Minecraft username', required: true, maxLength: 16 },
      { id: 'details', label: 'Describe the purchase issue', required: true, style: 'paragraph', maxLength: 1000 }
    ]
  },
  staff_recruitment: {
    label: 'Staff recruitment',
    description: 'Apply to join the server staff team.',
    fields: [
      { id: 'role', label: 'Role you are applying for', required: true, maxLength: 80 },
      { id: 'minecraft_name', label: 'Minecraft username', required: true, maxLength: 16 },
      { id: 'timezone', label: 'Timezone and availability', required: true, maxLength: 100 },
      { id: 'experience', label: 'Relevant experience', required: true, style: 'paragraph', maxLength: 1000 }
    ]
  },
  technical: {
    label: 'Technical issue / bug',
    description: 'Report a server issue or a bug.',
    fields: [
      { id: 'server', label: 'Server or game mode', required: true, maxLength: 100 },
      { id: 'minecraft_name', label: 'Minecraft username (optional)', required: false, maxLength: 16 },
      { id: 'details', label: 'Steps to reproduce and what happened', required: true, style: 'paragraph', maxLength: 1000 }
    ]
  },
  player_report: {
    label: 'Player report',
    description: 'Report a player and provide any evidence you have.',
    fields: [
      { id: 'reported_player', label: 'Player being reported', required: true, maxLength: 100 },
      { id: 'evidence', label: 'Evidence link (optional)', required: false, maxLength: 300 },
      { id: 'details', label: 'What happened and when?', required: true, style: 'paragraph', maxLength: 1000 }
    ]
  },
  other: {
    label: 'Other',
    description: 'Open a ticket for anything not listed above.',
    fields: [
      { id: 'subject', label: 'Ticket subject', required: true, maxLength: 100 },
      { id: 'minecraft_name', label: 'Minecraft username (optional)', required: false, maxLength: 16 },
      { id: 'details', label: 'How can we help?', required: true, style: 'paragraph', maxLength: 1000 }
    ]
  }
};

function getTicketCategory(key) {
  return ticketCategories[key] || null;
}

module.exports = { ticketCategories, getTicketCategory };
