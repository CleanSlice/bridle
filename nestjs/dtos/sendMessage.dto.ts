import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsArray, IsOptional, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class BridleImageDto {
  @ApiProperty({ description: 'Base64-encoded image data' })
  @IsString()
  @IsNotEmpty()
  base64: string

  @ApiProperty({ description: 'MIME type', example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  mediaType: string
}

export class SendMessageDto {
  @ApiProperty({ description: 'Message text' })
  @IsString()
  @IsNotEmpty()
  text: string

  @ApiPropertyOptional({ description: 'Attached images', type: [BridleImageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BridleImageDto)
  images?: BridleImageDto[]
}
