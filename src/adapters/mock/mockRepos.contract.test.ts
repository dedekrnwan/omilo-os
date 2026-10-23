import { runReposContract } from '../../core/ports/repos.contract'
import { createMockRepos } from './mockRepos'

runReposContract('mock', () => createMockRepos())
