import { ApiProperty } from '@nestjs/swagger';

export class ServiceInfoDto {
  @ApiProperty({ example: 'node-payment-microservice' })
  name!: string;

  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';
}

export class AppResponseDto {
  @ApiProperty({ enum: ['success'], example: 'success' })
  status!: 'success';

  @ApiProperty({ type: ServiceInfoDto })
  data!: ServiceInfoDto;
}
