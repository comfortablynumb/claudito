import fs from 'fs';
import {
  AutonomousLoopOrchestrator,
  MilestoneRef,
  LoopConfig,
} from '../../../src/agents/autonomous-loop-orchestrator';
import {
  createMockProjectRepository,
  createMockConversationRepository,
  createMockInstructionGenerator,
  createMockRoadmapParser,
  createTestPhase,
  createTestMilestone,
  createTestTask,
} from '../helpers/mock-factories';
import { ParsedRoadmap } from '../../../src/services/roadmap';

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

describe('AutonomousLoopOrchestrator', () => {
  let orchestrator: AutonomousLoopOrchestrator;
  let mockProjectRepo: ReturnType<typeof createMockProjectRepository>;
  let mockConversationRepo: ReturnType<typeof createMockConversationRepository>;
  let mockInstructionGen: ReturnType<typeof createMockInstructionGenerator>;
  let mockRoadmapParser: ReturnType<typeof createMockRoadmapParser>;

  const projectId = 'test-project-1';
  const projectPath = '/tmp/test-project';
  const loopConfig: LoopConfig = { projectId, projectPath };

  const sampleMilestone: MilestoneRef = {
    phaseId: 'phase-1',
    phaseTitle: 'Phase 1: Setup',
    milestoneId: 'milestone-1',
    milestoneTitle: 'Initial Setup',
    pendingTasks: ['Task 2'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockProjectRepo = createMockProjectRepository();
    mockConversationRepo = createMockConversationRepository();
    mockInstructionGen = createMockInstructionGenerator();
    mockRoadmapParser = createMockRoadmapParser();
    orchestrator = new AutonomousLoopOrchestrator(
      mockProjectRepo,
      mockConversationRepo,
      mockInstructionGen,
      mockRoadmapParser
    );
  });

  // =========================================================================
  // startLoop
  // =========================================================================
  describe('startLoop', () => {
    it('should return the first incomplete milestone', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');

      const result = await orchestrator.startLoop(loopConfig);

      expect(result).toEqual(sampleMilestone);
      expect(orchestrator.isLooping(projectId)).toBe(true);
    });

    it('should return null when no pending milestones exist', async () => {
      const allDone: ParsedRoadmap = {
        phases: [
          createTestPhase('p1', 'Phase 1', [
            createTestMilestone('m1', 'Done Milestone', [
              createTestTask('Task 1', true),
            ]),
          ]),
        ],
        currentPhase: 'p1',
        currentMilestone: 'm1',
        overallProgress: 100,
      };
      mockRoadmapParser.parse.mockReturnValue(allDone);
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');

      const result = await orchestrator.startLoop(loopConfig);

      expect(result).toBeNull();
      expect(orchestrator.isLooping(projectId)).toBe(false);
    });

    it('should return null when roadmap file cannot be read', async () => {
      (fs.promises.readFile as jest.Mock).mockRejectedValue(
        new Error('ENOENT')
      );

      const result = await orchestrator.startLoop(loopConfig);

      expect(result).toBeNull();
      expect(orchestrator.isLooping(projectId)).toBe(false);
    });

    it('should throw if loop is already running', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');
      await orchestrator.startLoop(loopConfig);

      await expect(orchestrator.startLoop(loopConfig)).rejects.toThrow(
        'Autonomous loop is already running for this project'
      );
    });
  });

  // =========================================================================
  // stopLoop
  // =========================================================================
  describe('stopLoop', () => {
    it('should stop a running loop', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');
      await orchestrator.startLoop(loopConfig);

      expect(orchestrator.isLooping(projectId)).toBe(true);
      orchestrator.stopLoop(projectId);
      expect(orchestrator.isLooping(projectId)).toBe(false);
    });

    it('should be safe to call on a non-running project', () => {
      expect(() => orchestrator.stopLoop('nonexistent')).not.toThrow();
    });
  });

  // =========================================================================
  // isLooping / shouldContinueLoop
  // =========================================================================
  describe('isLooping / shouldContinueLoop', () => {
    it('should return false for unknown project', () => {
      expect(orchestrator.isLooping('unknown')).toBe(false);
      expect(orchestrator.shouldContinueLoop('unknown')).toBe(false);
    });

    it('should return true after startLoop', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');
      await orchestrator.startLoop(loopConfig);

      expect(orchestrator.isLooping(projectId)).toBe(true);
      expect(orchestrator.shouldContinueLoop(projectId)).toBe(true);
    });
  });

  // =========================================================================
  // getLoopState
  // =========================================================================
  describe('getLoopState', () => {
    it('should return null for unknown project', () => {
      expect(orchestrator.getLoopState('unknown')).toBeNull();
    });

    it('should return current state after startLoop', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');
      await orchestrator.startLoop(loopConfig);

      const state = orchestrator.getLoopState(projectId);

      expect(state).toEqual({
        isLooping: true,
        currentMilestone: null,
        currentConversationId: null,
      });
    });

    it('should reflect milestone after setCurrentMilestone', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');
      await orchestrator.startLoop(loopConfig);
      orchestrator.setCurrentMilestone(projectId, sampleMilestone, 'conv-1');

      const state = orchestrator.getLoopState(projectId);

      expect(state?.currentMilestone).toEqual(sampleMilestone);
      expect(state?.currentConversationId).toBe('conv-1');
    });
  });

  // =========================================================================
  // setCurrentMilestone
  // =========================================================================
  describe('setCurrentMilestone', () => {
    it('should emit milestoneStarted event', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');
      await orchestrator.startLoop(loopConfig);

      const listener = jest.fn();
      orchestrator.on('milestoneStarted', listener);

      orchestrator.setCurrentMilestone(projectId, sampleMilestone, 'conv-1');

      expect(listener).toHaveBeenCalledWith(projectId, sampleMilestone);
    });

    it('should be a no-op when project has no loop state', () => {
      expect(() =>
        orchestrator.setCurrentMilestone('unknown', sampleMilestone, 'conv-1')
      ).not.toThrow();
    });
  });

  // =========================================================================
  // handleMilestoneComplete
  // =========================================================================
  describe('handleMilestoneComplete', () => {
    beforeEach(async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');
      await orchestrator.startLoop(loopConfig);
    });

    it('should emit milestoneCompleted and return next milestone', async () => {
      const roadmapWithTwo: ParsedRoadmap = {
        phases: [
          createTestPhase('p1', 'Phase 1', [
            createTestMilestone('m1', 'Done', [createTestTask('T1', true)]),
            createTestMilestone('m2', 'Next', [createTestTask('T2', false)]),
          ]),
        ],
        currentPhase: 'p1',
        currentMilestone: 'm2',
        overallProgress: 50,
      };
      mockRoadmapParser.parse.mockReturnValue(roadmapWithTwo);

      const listener = jest.fn();
      orchestrator.on('milestoneCompleted', listener);

      const next = await orchestrator.handleMilestoneComplete(
        projectId,
        projectPath,
        sampleMilestone,
        'All done'
      );

      expect(listener).toHaveBeenCalledWith(
        projectId,
        sampleMilestone,
        'All done'
      );
      expect(next).toEqual({
        phaseId: 'p1',
        phaseTitle: 'Phase 1',
        milestoneId: 'm2',
        milestoneTitle: 'Next',
        pendingTasks: ['T2'],
      });
    });

    it('should return null and emit loopCompleted when no more milestones', async () => {
      const allDone: ParsedRoadmap = {
        phases: [
          createTestPhase('p1', 'Phase 1', [
            createTestMilestone('m1', 'Done', [createTestTask('T1', true)]),
          ]),
        ],
        currentPhase: 'p1',
        currentMilestone: 'm1',
        overallProgress: 100,
      };
      mockRoadmapParser.parse.mockReturnValue(allDone);

      const loopCompletedListener = jest.fn();
      orchestrator.on('loopCompleted', loopCompletedListener);

      const next = await orchestrator.handleMilestoneComplete(
        projectId,
        projectPath,
        sampleMilestone,
        'Done'
      );

      expect(next).toBeNull();
      expect(loopCompletedListener).toHaveBeenCalledWith(projectId);
      expect(orchestrator.isLooping(projectId)).toBe(false);
    });

    it('should return null when loop was stopped by user', async () => {
      orchestrator.stopLoop(projectId);

      // Re-start so we can test the shouldContinue=false path
      await orchestrator.startLoop(loopConfig);
      // Manually stop to set shouldContinue=false
      // We need to access internal state, so let's use stopLoop which cleans up
      // Instead, let's test the full flow: start, then stop before handleMilestoneComplete
      orchestrator.stopLoop(projectId);

      // Start fresh and simulate the race condition
      await orchestrator.startLoop(loopConfig);

      // Now simulate user stopping mid-loop by directly manipulating shouldContinue
      // We use stopLoop which sets shouldContinue=false AND cleans up
      // So let's use a listener approach instead
      const milestoneCompletedListener = jest.fn();
      orchestrator.on('milestoneCompleted', milestoneCompletedListener);

      // Stop right before checking shouldContinue
      // The only way to test this is to have shouldContinue=false
      // stopLoop sets it to false but also deletes the state
      // So the handleMilestoneComplete will see shouldContinueLoop as false
      orchestrator.stopLoop(projectId);

      const next = await orchestrator.handleMilestoneComplete(
        projectId,
        projectPath,
        sampleMilestone,
        'Done'
      );

      // milestoneCompleted still fires (before shouldContinue check)
      // but since the state was cleaned up, shouldContinueLoop returns false
      expect(next).toBeNull();
    });
  });

  // =========================================================================
  // handleMilestoneFailed
  // =========================================================================
  describe('handleMilestoneFailed', () => {
    it('should emit milestoneFailed and cleanup', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');
      await orchestrator.startLoop(loopConfig);

      const listener = jest.fn();
      orchestrator.on('milestoneFailed', listener);

      orchestrator.handleMilestoneFailed(
        projectId,
        sampleMilestone,
        'Build failed'
      );

      expect(listener).toHaveBeenCalledWith(
        projectId,
        sampleMilestone,
        'Build failed'
      );
      expect(orchestrator.isLooping(projectId)).toBe(false);
    });

    it('should accept null milestone', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');
      await orchestrator.startLoop(loopConfig);

      const listener = jest.fn();
      orchestrator.on('milestoneFailed', listener);

      orchestrator.handleMilestoneFailed(projectId, null, 'No roadmap');

      expect(listener).toHaveBeenCalledWith(projectId, null, 'No roadmap');
    });
  });

  // =========================================================================
  // generateMilestoneInstructions
  // =========================================================================
  describe('generateMilestoneInstructions', () => {
    it('should call instructionGenerator.generateForMilestone', () => {
      mockInstructionGen.generateForMilestone.mockReturnValue(
        'Do these tasks'
      );

      const result = orchestrator.generateMilestoneInstructions(
        projectId,
        'My Project',
        sampleMilestone
      );

      expect(result).toBe('Do these tasks');
      expect(mockInstructionGen.generateForMilestone).toHaveBeenCalledWith(
        '',
        {
          projectName: 'My Project',
          phaseTitle: sampleMilestone.phaseTitle,
          milestoneTitle: sampleMilestone.milestoneTitle,
          pendingTasks: sampleMilestone.pendingTasks,
        }
      );
    });
  });

  // =========================================================================
  // parseAgentResponse
  // =========================================================================
  describe('parseAgentResponse', () => {
    describe('completion patterns', () => {
      it('should detect MILESTONE COMPLETE', () => {
        const result = orchestrator.parseAgentResponse(
          'MILESTONE COMPLETE: All tasks done'
        );

        expect(result).toEqual({
          status: 'COMPLETE',
          reason: 'All tasks done',
        });
      });

      it('should detect checkmark milestone completed', () => {
        const result = orchestrator.parseAgentResponse(
          '✓ Milestone completed: Everything passes'
        );

        expect(result).toEqual({
          status: 'COMPLETE',
          reason: 'Everything passes',
        });
      });

      it('should detect STATUS: COMPLETE', () => {
        const result = orchestrator.parseAgentResponse(
          'STATUS: COMPLETE: All good'
        );

        expect(result).toEqual({
          status: 'COMPLETE',
          reason: 'All good',
        });
      });

      it('should detect "All tasks completed"', () => {
        const result = orchestrator.parseAgentResponse(
          'All tasks completed successfully.'
        );

        expect(result).toEqual({
          status: 'COMPLETE',
          reason: 'All tasks completed successfully',
        });
      });

      it('should detect "All task done"', () => {
        const result = orchestrator.parseAgentResponse(
          'All task done and tested!'
        );

        expect(result).toEqual({
          status: 'COMPLETE',
          reason: 'All tasks completed successfully',
        });
      });
    });

    describe('failure patterns', () => {
      it('should detect MILESTONE FAILED', () => {
        const result = orchestrator.parseAgentResponse(
          'MILESTONE FAILED: Tests broken'
        );

        expect(result).toEqual({
          status: 'FAILED',
          reason: 'Tests broken',
        });
      });

      it('should detect STATUS: FAILED', () => {
        const result = orchestrator.parseAgentResponse(
          'STATUS: FAILED: Build error'
        );

        expect(result).toEqual({
          status: 'FAILED',
          reason: 'Build error',
        });
      });

      it('should detect "Unable to complete milestone"', () => {
        const result = orchestrator.parseAgentResponse(
          'Unable to complete milestone: Missing deps'
        );

        expect(result).toEqual({
          status: 'FAILED',
          reason: 'Missing deps',
        });
      });

      it('should detect "Critical error"', () => {
        const result = orchestrator.parseAgentResponse(
          'Critical error: Out of memory'
        );

        expect(result).toEqual({
          status: 'FAILED',
          reason: 'Out of memory',
        });
      });
    });

    describe('last-line fallback detection', () => {
      it('should detect "complete" in last lines', () => {
        const output = [
          'Working on tasks...',
          'Running tests...',
          'All tests pass',
          'Tasks are complete',
        ].join('\n');

        const result = orchestrator.parseAgentResponse(output);

        expect(result).toEqual({
          status: 'COMPLETE',
          reason: 'Tasks completed',
        });
      });

      it('should detect "failed" in last lines', () => {
        const output = [
          'Working on tasks...',
          'Running tests...',
          'Build failed with 3 errors',
        ].join('\n');

        const result = orchestrator.parseAgentResponse(output);

        expect(result).toEqual({
          status: 'FAILED',
          reason: 'Build failed with 3 errors',
        });
      });

      it('should detect "error" in last lines', () => {
        const output = [
          'Line 1',
          'Line 2',
          'Line 3',
          'Line 4',
          'Compilation error in module X',
        ].join('\n');

        const result = orchestrator.parseAgentResponse(output);

        expect(result).toEqual({
          status: 'FAILED',
          reason: 'Compilation error in module X',
        });
      });

      it('should not match "incomplete" as "complete"', () => {
        const output = [
          'Line 1',
          'Line 2',
          'Line 3',
          'Line 4',
          'Work is incomplete',
        ].join('\n');

        const result = orchestrator.parseAgentResponse(output);

        // 'incomplete' should NOT match the complete check
        expect(result).toBeNull();
      });
    });

    it('should return null for ambiguous output', () => {
      const result = orchestrator.parseAgentResponse(
        'Still working on the task, need more time'
      );

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getRunningProjectIds
  // =========================================================================
  describe('getRunningProjectIds', () => {
    it('should return empty array when no loops running', () => {
      expect(orchestrator.getRunningProjectIds()).toEqual([]);
    });

    it('should return ids of running loops', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');
      await orchestrator.startLoop(loopConfig);

      expect(orchestrator.getRunningProjectIds()).toEqual([projectId]);
    });
  });

  // =========================================================================
  // on / off events
  // =========================================================================
  describe('event system', () => {
    it('should support multiple listeners for the same event', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');
      await orchestrator.startLoop(loopConfig);

      const listener1 = jest.fn();
      const listener2 = jest.fn();
      orchestrator.on('milestoneStarted', listener1);
      orchestrator.on('milestoneStarted', listener2);

      orchestrator.setCurrentMilestone(projectId, sampleMilestone, 'conv-1');

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe with off', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');
      await orchestrator.startLoop(loopConfig);

      const listener = jest.fn();
      orchestrator.on('milestoneStarted', listener);
      orchestrator.off('milestoneStarted', listener);

      orchestrator.setCurrentMilestone(projectId, sampleMilestone, 'conv-1');

      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle listener errors gracefully', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');
      await orchestrator.startLoop(loopConfig);

      const badListener = jest.fn().mockImplementation(() => {
        throw new Error('Listener exploded');
      });
      const goodListener = jest.fn();

      orchestrator.on('milestoneStarted', badListener);
      orchestrator.on('milestoneStarted', goodListener);

      // Should not throw despite listener error
      expect(() =>
        orchestrator.setCurrentMilestone(projectId, sampleMilestone, 'conv-1')
      ).not.toThrow();

      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });

    it('should handle off for non-existent event', () => {
      const listener = jest.fn();

      expect(() =>
        orchestrator.off('milestoneStarted', listener)
      ).not.toThrow();
    });
  });

  // =========================================================================
  // getNextMilestone (via startLoop — private method)
  // =========================================================================
  describe('getNextMilestone (through public API)', () => {
    it('should find first incomplete milestone across phases', async () => {
      const multiPhase: ParsedRoadmap = {
        phases: [
          createTestPhase('p1', 'Phase 1', [
            createTestMilestone('m1', 'All Done', [
              createTestTask('T1', true),
            ]),
          ]),
          createTestPhase('p2', 'Phase 2', [
            createTestMilestone('m2', 'Next Up', [
              createTestTask('T2', false),
              createTestTask('T3', false),
            ]),
          ]),
        ],
        currentPhase: 'p2',
        currentMilestone: 'm2',
        overallProgress: 33,
      };
      mockRoadmapParser.parse.mockReturnValue(multiPhase);
      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Roadmap');

      const result = await orchestrator.startLoop(loopConfig);

      expect(result).toEqual({
        phaseId: 'p2',
        phaseTitle: 'Phase 2',
        milestoneId: 'm2',
        milestoneTitle: 'Next Up',
        pendingTasks: ['T2', 'T3'],
      });
    });
  });
});
