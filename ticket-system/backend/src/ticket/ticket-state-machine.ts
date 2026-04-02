import { ForbiddenException, BadRequestException } from '@nestjs/common';

export type TicketStatus = 'PENDING' | 'ACCEPTED' | 'IN_PROGRESS' | 'PENDING_CLOSE' | 'CLOSED';
export type UserRole = 'CUSTOMER' | 'OPERATOR' | 'ENGINEER' | 'ADMIN';

interface Actor { id: string; role: UserRole; }
interface TicketSnapshot { status: TicketStatus; }

const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  PENDING:       ['ACCEPTED'],
  ACCEPTED:      ['IN_PROGRESS'],
  IN_PROGRESS:   ['PENDING_CLOSE'],
  PENDING_CLOSE: ['CLOSED', 'IN_PROGRESS'],
  CLOSED:        [],
};

const ROLE_PERMISSIONS: Partial<Record<TicketStatus, UserRole[]>> = {
  ACCEPTED:      ['OPERATOR', 'ENGINEER', 'ADMIN'],
  IN_PROGRESS:   ['ENGINEER', 'ADMIN', 'OPERATOR'],
  PENDING_CLOSE: ['ENGINEER', 'ADMIN'],
  CLOSED:        ['OPERATOR', 'ADMIN'],
};

export function validateTransition(ticket: TicketSnapshot, newStatus: TicketStatus, actor: Actor): void {
  const allowed = VALID_TRANSITIONS[ticket.status];
  if (!allowed.includes(newStatus)) {
    throw new BadRequestException(`非法状态流转: ${ticket.status} → ${newStatus}`);
  }
  const requiredRoles = ROLE_PERMISSIONS[newStatus];
  if (requiredRoles && !requiredRoles.includes(actor.role)) {
    throw new ForbiddenException(`角色 ${actor.role} 无权执行此状态变更`);
  }
}

export function getTimestampUpdates(newStatus: TicketStatus): Record<string, Date> {
  const now = new Date();
  const updates: Record<string, Date> = {};
  if (newStatus === 'ACCEPTED') {
    updates.acceptedAt = now;
    updates.firstResponseAt = now;
  } else if (newStatus === 'CLOSED') {
    updates.closedAt = now;
  }
  return updates;
}
