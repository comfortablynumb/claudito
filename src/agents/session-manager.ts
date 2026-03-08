import { getLogger, Logger, isValidUUID } from '../utils';
import {
  ProjectRepository,
  ConversationRepository,
} from '../repositories';
import { ContextUsage } from './agent';

export interface SessionRecoveryResult {
  conversationId: string;
  sessionId: string;
  isNewSession: boolean;
  recoveryReason?: string;
}

export interface SessionManagerEvents {
  sessionRecovery: (
    projectId: string,
    oldConversationId: string,
    newConversationId: string,
    reason: string
  ) => void;
}

/**
 * Manages agent session lifecycle including validation, recovery, and creation.
 * Handles conversation ID to session ID mapping and recovery scenarios.
 */
export class SessionManager {
  private readonly logger: Logger;
  private readonly listeners: Map<keyof SessionManagerEvents, Set<(...args: unknown[]) => void>> = new Map();

  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly conversationRepository: ConversationRepository
  ) {
    this.logger = getLogger('session-manager');
  }

  /**
   * Validate if a session exists by checking if we can find the conversation.
   */
  async validateSession(projectId: string, conversationId: string): Promise<boolean> {
    if (!isValidUUID(conversationId)) {
      return false;
    }

    try {
      const conversation = await this.conversationRepository.findById(projectId, conversationId);
      return conversation !== null;
    } catch (error) {
      this.logger.error('Error validating session', {
        conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Recover a session by validating the conversation exists.
   * If recovery fails, creates a new session.
   *
   * @returns The session ID to use (which is the conversation ID)
   */
  async recoverSession(
    projectId: string,
    conversationId: string
  ): Promise<SessionRecoveryResult> {
    const isValid = await this.validateSession(projectId, conversationId);

    if (isValid) {
      this.logger.info('Session validated successfully', { projectId, conversationId });
      return {
        conversationId,
        sessionId: conversationId,
        isNewSession: false,
      };
    }

    // Session recovery failed, create a new session
    this.logger.warn('Session recovery failed, creating new session', {
      projectId,
      oldConversationId: conversationId,
    });

    const result = await this.createNewSession(projectId);

    // Emit recovery event
    this.emit('sessionRecovery', projectId, conversationId, result.conversationId, 'Session not found');

    return {
      ...result,
      recoveryReason: 'Session not found',
    };
  }

  /**
   * Create a new session with a new conversation.
   */
  async createNewSession(projectId: string): Promise<SessionRecoveryResult> {
    const conversation = await this.conversationRepository.create(projectId, null);

    await this.projectRepository.setCurrentConversation(projectId, conversation.id);

    this.logger.info('Created new session', {
      projectId,
      conversationId: conversation.id,
    });

    return {
      conversationId: conversation.id,
      sessionId: conversation.id,
      isNewSession: true,
    };
  }

  /**
   * Get or create a session for a project.
   */
  async getOrCreateSession(
    projectId: string,
    requestedSessionId?: string,
    isNewSessionRequested?: boolean
  ): Promise<SessionRecoveryResult> {
    const project = await this.projectRepository.findById(projectId);

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // If a specific session ID is requested
    if (requestedSessionId) {
      if (!isValidUUID(requestedSessionId)) {
        this.logger.warn('Invalid session ID format, recovering', {
          projectId,
          requestedSessionId,
        });

        // Delete the invalid conversation since it was explicitly requested
        try {
          await this.conversationRepository.deleteConversation(projectId, requestedSessionId);
        } catch (error) {
          this.logger.error('Failed to delete invalid conversation', {
            projectId,
            conversationId: requestedSessionId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        // Treat invalid UUID as session recovery case
        return await this.recoverSession(projectId, requestedSessionId);
      }

      // Check if the conversation exists
      const conversation = await this.conversationRepository.findById(projectId, requestedSessionId);

      if (conversation && conversation.projectId === projectId) {
        await this.projectRepository.setCurrentConversation(projectId, requestedSessionId);
        return {
          conversationId: requestedSessionId,
          sessionId: requestedSessionId,
          isNewSession: false,
        };
      }

      // Requested session doesn't exist or belongs to different project
      this.logger.warn('Requested session not found or invalid', {
        projectId,
        requestedSessionId,
        conversationProjectId: conversation?.projectId,
      });
    }

    // If new session is explicitly requested
    if (isNewSessionRequested) {
      return await this.createNewSession(projectId);
    }

    // Use current conversation if available
    if (project.currentConversationId) {
      const isValid = await this.validateSession(projectId, project.currentConversationId);

      if (isValid) {
        return {
          conversationId: project.currentConversationId,
          sessionId: project.currentConversationId,
          isNewSession: false,
        };
      }

      // Current conversation is invalid, recover
      return await this.recoverSession(projectId, project.currentConversationId);
    }

    // No current conversation, create new
    return await this.createNewSession(projectId);
  }

  /**
   * Clean up a session that couldn't be resumed.
   * Deletes the old conversation and creates a new one.
   */
  async handleSessionNotFound(
    projectId: string,
    missingSessionId: string
  ): Promise<SessionRecoveryResult> {
    this.logger.warn('Handling session not found', {
      projectId,
      missingSessionId,
    });

    // Try to delete the old conversation
    try {
      await this.conversationRepository.deleteConversation(projectId, missingSessionId);
      this.logger.info('Deleted missing conversation', { conversationId: missingSessionId });
    } catch (error) {
      this.logger.debug('Could not delete conversation (may not exist)', {
        conversationId: missingSessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Create new session
    const result = await this.createNewSession(projectId);

    // Emit recovery event
    this.emit('sessionRecovery', projectId, missingSessionId, result.conversationId, 'Session not found by Claude');

    return result;
  }

  /**
   * Save context usage to conversation metadata.
   */
  async saveContextUsage(
    projectId: string,
    conversationId: string,
    contextUsage: ContextUsage
  ): Promise<void> {
    try {
      await this.conversationRepository.updateMetadata(projectId, conversationId, {
        contextUsage,
      });
    } catch (error) {
      this.logger.error('Failed to save context usage', {
        projectId,
        conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Subscribe to session events.
   */
  on<K extends keyof SessionManagerEvents>(event: K, listener: SessionManagerEvents[K]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as (...args: unknown[]) => void);
  }

  /**
   * Unsubscribe from session events.
   */
  off<K extends keyof SessionManagerEvents>(event: K, listener: SessionManagerEvents[K]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener as (...args: unknown[]) => void);
    }
  }

  private emit<K extends keyof SessionManagerEvents>(
    event: K,
    ...args: Parameters<SessionManagerEvents[K]>
  ): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          (listener)(...args);
        } catch (error) {
          this.logger.error(`Error in ${event} listener`, { error });
        }
      });
    }
  }
}