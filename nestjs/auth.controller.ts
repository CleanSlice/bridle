import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger'
import { JwtService } from '@nestjs/jwt'

/**
 * Dev auth controller — generates JWT tokens for browser clients.
 * In production, tokens come from your real auth system.
 */
@ApiTags('auth')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly jwt: JwtService) {}

  @ApiOperation({ description: 'Get a dev JWT token for browser chat', operationId: 'getDevToken' })
  @ApiQuery({ name: 'name', required: false, description: 'User name (default: dev-user)' })
  @Get('token')
  getToken(@Query('name') name?: string) {
    const payload = {
      sub: name || 'dev-user',
      email: `${name || 'dev-user'}@local`,
      roles: ['ADMIN'],
    }
    return { token: this.jwt.sign(payload) }
  }
}
